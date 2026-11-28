import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-arena-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
};
const number = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid " + label);
  return parsed;
};
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const contractSize = 100;
const leverage = 1000;

type Quote = {
  mid: number; bid: number; ask: number; spread: number;
  source: string; price_as_of: string; is_stale: boolean; received_at: string;
};
type Member = { id: string; participant_id: string | null; role: "participant" | "admin" };

function oandaBase() {
  return Deno.env.get("OANDA_ENV") === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
}
async function fetchOandaQuote() {
  const token = Deno.env.get("OANDA_API_TOKEN");
  const accountId = Deno.env.get("OANDA_ACCOUNT_ID");
  if (!token || !accountId) return null;
  const url = oandaBase() + "/v3/accounts/" + encodeURIComponent(accountId) + "/pricing?instruments=XAU_USD";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("OANDA pricing request failed (" + res.status + ")");
  const body = await res.json();
  const price = body?.prices?.[0];
  const bid = Number(price?.bids?.[0]?.price);
  const ask = Number(price?.asks?.[0]?.price);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) throw new Error("OANDA did not return a valid XAU_USD quote");
  return {
    mid: (bid + ask) / 2, bid, ask, spread: ask - bid,
    source: "OANDA practice API", price_as_of: price.time || new Date().toISOString(), is_stale: false,
  };
}
async function fetchXausQuote(previous: any) {
  const res = await fetch("https://xaus.com/api/v1/spot?currency=USD&unit=oz&compact=1", {
    headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("XAUS price request failed (" + res.status + ")");
  const body = await res.json();
  const mid = Number(body?.spot_usd_oz);
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("XAUS returned no valid XAU/USD spot price");
  const move = previous ? Math.abs(mid - Number(previous.mid)) : 0.18;
  const spread = clamp(0.2 + move * 0.65, 0.2, 0.9);
  return {
    mid, bid: mid - spread / 2, ask: mid + spread / 2, spread,
    source: "XAUS spot reference", price_as_of: body.price_as_of || body.updated_at || new Date().toISOString(),
    is_stale: body.stale === true || body?.data_state?.status === "stale",
  };
}
async function getQuote(db: any): Promise<Quote | null> {
  const { data: cached } = await db.from("market_quote_cache").select("*").eq("id", 1).maybeSingle();
  if (cached && Date.now() - new Date(cached.received_at).getTime() < 55_000) {
    return {
      mid: Number(cached.mid), bid: Number(cached.bid), ask: Number(cached.ask), spread: Number(cached.spread),
      source: cached.source, price_as_of: cached.price_as_of, is_stale: cached.is_stale,
      received_at: cached.received_at,
    };
  }
  try {
    let raw: any = null;
    try { raw = await fetchOandaQuote(); } catch { raw = null; }
    if (!raw) raw = await fetchXausQuote(cached);
    const quote: Quote = { ...raw, received_at: new Date().toISOString() };
    await db.from("market_quote_cache").upsert({
      id: 1, mid: quote.mid, bid: quote.bid, ask: quote.ask, spread: quote.spread,
      source: quote.source, price_as_of: quote.price_as_of, is_stale: quote.is_stale, received_at: quote.received_at,
    }, { onConflict: "id" });
    return quote;
  } catch {
    if (cached) return {
      mid: Number(cached.mid), bid: Number(cached.bid), ask: Number(cached.ask), spread: Number(cached.spread),
      source: cached.source + " (last known)", price_as_of: cached.price_as_of, is_stale: true,
      received_at: cached.received_at,
    };
    return null;
  }
}
function unrealized(trade: any, quote: Quote) {
  const exit = trade.side === "BUY" ? quote.bid : quote.ask;
  return (exit - Number(trade.entry_price)) * contractSize * Number(trade.lots) * (trade.side === "BUY" ? 1 : -1);
}
async function closeTrade(db: any, trade: any, quote: Quote, reason = "manual") {
  if (trade.status !== "open") return;
  const exit = trade.side === "BUY" ? quote.bid : quote.ask;
  const { error } = await db.rpc("close_paper_trade", {
    p_trade_id: trade.id,
    p_exit_price: exit
  });
  if (error) throw error;
}
async function settleQuote(db: any, competition: any, quote: Quote) {
  if (!quote || quote.is_stale || competition.status !== "running" || competition.is_paused) return;
  const { data: active, error } = await db.from("paper_trades").select("*")
    .eq("competition_id", competition.id).in("status", ["pending", "open"]).is("archived_at", null);
  if (error || !active) return;
  for (const trade of active) {
    if (trade.status === "pending") {
      const trigger = Number(trade.trigger_price);
      const hit = trade.side === "BUY"
        ? (trade.order_type === "LIMIT" ? quote.ask <= trigger : quote.ask >= trigger)
        : (trade.order_type === "LIMIT" ? quote.bid >= trigger : quote.bid <= trigger);
      if (!hit) continue;
      const entry = trade.side === "BUY" ? quote.ask : quote.bid;
      await db.from("paper_trades").update({
        status: "open", entry_price: entry, opened_at: new Date().toISOString(), spread_at_entry: quote.spread,
      }).eq("id", trade.id).eq("status", "pending");
      trade.status = "open"; trade.entry_price = entry;
    }
    if (trade.status === "open") {
      const mark = trade.side === "BUY" ? quote.bid : quote.ask;
      const slHit = trade.stop_loss != null && Number(trade.stop_loss) > 0 &&
        (trade.side === "BUY" ? mark <= Number(trade.stop_loss) : mark >= Number(trade.stop_loss));
      const tpHit = trade.take_profit != null && Number(trade.take_profit) > 0 &&
        (trade.side === "BUY" ? mark >= Number(trade.take_profit) : mark <= Number(trade.take_profit));
      if (slHit || tpHit) await closeTrade(db, trade, quote, slHit ? "stop_loss" : "take_profit");
    }
  }
}
async function getCompetition(db: any) {
  const { data, error } = await db.from("competitions").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !data) throw new Error("Competition configuration not found");
  return data;
}
function maxDrawdownPct(trades: any[]) {
  let equity = 50, peak = 50, worst = 0;
  for (const trade of [...trades].filter(t => t.status === "closed").sort((a,b) => new Date(a.closed_at || a.created_at).getTime() - new Date(b.closed_at || b.created_at).getTime())) {
    equity += Number(trade.realized_profit || 0);
    peak = Math.max(peak, equity);
    if (peak > 0) worst = Math.max(worst, (peak - equity) / peak * 100);
  }
  return Number(worst.toFixed(2));
}
async function buildState(db: any, member: Member) {
  const competition = await getCompetition(db);
  const quote = await getQuote(db);
  if (quote) await settleQuote(db, competition, quote);
  if (competition.status === "running" && !competition.is_paused && competition.ends_at &&
      Date.now() >= new Date(competition.ends_at).getTime() && quote && !quote.is_stale) {
    const { data: open } = await db.from("paper_trades").select("*").eq("competition_id", competition.id)
      .eq("status", "open").is("archived_at", null);
    for (const trade of open || []) await closeTrade(db, trade, quote, "competition_end");
    await db.from("paper_trades").update({ status: "cancelled" }).eq("competition_id", competition.id)
      .eq("status", "pending").is("archived_at", null);
    await db.from("competitions").update({ status: "completed", completed_at: new Date().toISOString(), is_paused: false, paused_at: null }).eq("id", competition.id);
    competition.status = "completed";
    competition.completed_at = new Date().toISOString();
  }
  const { data: people, error: peopleError } = await db.from("participants")
    .select("id,display_name,starting_balance").eq("competition_id", competition.id).order("created_at");
  if (peopleError) throw peopleError;
  const ids = (people || []).map((p: any) => p.id);
  const { data: accounts } = await db.from("paper_accounts").select("participant_id,balance").in("participant_id", ids);
  const { data: active } = await db.from("paper_trades").select("participant_id,side,lots,entry_price,status,trigger_price")
    .in("participant_id", ids).in("status", ["open", "pending"]).is("archived_at", null);
  const { data: allClosed } = await db.from("paper_trades").select("participant_id,status,realized_profit,closed_at,created_at")
    .in("participant_id", ids).eq("status", "closed").is("archived_at", null);
  const accountMap = new Map((accounts || []).map((a: any) => [a.participant_id, Number(a.balance)]));
  const equityMap = new Map<string, number>();
  const marginMap = new Map<string, number>();
  for (const p of people || []) {
    equityMap.set(p.id, accountMap.get(p.id) ?? 50);
    marginMap.set(p.id, 0);
  }
  if (quote) for (const t of active || []) {
    if (t.status !== "open") continue;
    equityMap.set(t.participant_id, (equityMap.get(t.participant_id) || 50) + unrealized(t, quote));
    marginMap.set(t.participant_id, (marginMap.get(t.participant_id) || 0) + (quote.mid * contractSize * Number(t.lots) / leverage));
  }
  const leaderboard = (people || []).map((p: any) => {
    const balance = accountMap.get(p.id) ?? 50;
    const equity = Number((equityMap.get(p.id) ?? balance).toFixed(2));
    const drawdown = maxDrawdownPct((allClosed || []).filter((t: any) => t.participant_id === p.id));
    return {
      id: p.id, display_name: p.display_name, balance: Number(balance.toFixed(2)), equity,
      return_pct: Number((((equity - 50) / 50) * 100).toFixed(2)), drawdown_pct: drawdown,
      margin_used: Number((marginMap.get(p.id) || 0).toFixed(2)),
    };
  }).sort((a: any, b: any) => b.return_pct - a.return_pct || a.drawdown_pct - b.drawdown_pct);
  let me: any = null, myTrades: any[] = [];
  if (member.participant_id) {
    me = leaderboard.find((p: any) => p.id === member.participant_id) || null;
    const { data: rows, error: tradeError } = await db.from("paper_trades").select("*")
      .eq("participant_id", member.participant_id).is("archived_at", null)
      .order("created_at", { ascending: false }).limit(100);
    if (tradeError) throw tradeError;
    myTrades = rows || [];
  }
  return {
    role: member.role, me, leaderboard, myTrades, quote,
    competition: {
      id: competition.id, name: competition.name, status: competition.status,
      is_paused: Boolean(competition.is_paused), starts_at: competition.starts_at,
      ends_at: competition.ends_at, max_duration_minutes: competition.max_duration_minutes,
      completed_at: competition.completed_at, winner_metric: competition.winner_metric,
      contract_size_oz: Number(competition.contract_size_oz || contractSize),
      leverage: Number(competition.leverage || leverage),
    },
    server_time: new Date().toISOString(),
  };
}
async function loadCandles(timeframe: string) {
  const token = Deno.env.get("OANDA_API_TOKEN");
  const accountId = Deno.env.get("OANDA_ACCOUNT_ID");
  const granularity: Record<string,string> = { "1m":"M1", "5m":"M5", "15m":"M15", "1h":"H1", "4h":"H4" };
  if (!granularity[timeframe]) throw new Error("Unsupported timeframe");
  if (token && accountId) {
    try {
      const url = oandaBase() + "/v3/accounts/" + encodeURIComponent(accountId) +
        "/instruments/XAU_USD/candles?granularity=" + granularity[timeframe] + "&count=300&price=M";
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const body = await res.json();
        const candles = (body.candles || []).filter((c: any) => c.complete && c.mid).map((c: any) => ({
          time: c.time, open: Number(c.mid.o), high: Number(c.mid.h), low: Number(c.mid.l), close: Number(c.mid.c), volume: Number(c.volume || 0),
        }));
        if (candles.length) return { candles, source: "OANDA practice candles", timeframe };
      }
    } catch { /* fall back to XAUS intraday samples */ }
  }
  if (timeframe === "1m") throw new Error("1-minute candles need OANDA API credentials; XAUS supplies 5-minute samples.");
  const res = await fetch("https://xaus.com/api/v1/intraday?symbol=xau&hours=48", {
    headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("XAUS intraday history unavailable");
  const body = await res.json();
  const points = Array.isArray(body.points) ? body.points : [];
  const bucketMs = timeframe === "5m" ? 300000 : timeframe === "15m" ? 900000 : timeframe === "1h" ? 3600000 : 14400000;
  const buckets = new Map<number, any>();
  for (const point of points) {
    const ts = typeof point.t === "number" ? (point.t < 1e12 ? point.t * 1000 : point.t) : Date.parse(point.t);
    const price = Number(point.p);
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    const old = buckets.get(bucket);
    if (!old) buckets.set(bucket, { ms: bucket, time: new Date(bucket).toISOString(), open: price, high: price, low: price, close: price, volume: 0 });
    else { old.high = Math.max(old.high, price); old.low = Math.min(old.low, price); old.close = price; }
  }
  return { candles: [...buckets.values()].sort((a,b) => a.ms - b.ms).slice(-300), source: "XAUS 5-minute reference samples", timeframe };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ error: "Backend is not configured" }, 500);
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return reply({ error: "Request too large" }, 413);
    body = JSON.parse(raw);
  } catch { return reply({ error: "Invalid JSON" }, 400); }
  const code = (req.headers.get("x-arena-code") || body.invite_code || "").trim();
  if (code.length < 32 || code.length > 128) return reply({ error: "Enter a valid invite code" }, 401);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: credential, error: credentialError } = await db.from("arena_credentials")
    .select("id,participant_id,role").eq("token_hash", await sha256(code)).is("revoked_at", null).maybeSingle();
  if (credentialError || !credential) return reply({ error: "Invite code is invalid or revoked" }, 401);
  const member: Member = credential;
  const action = String(body.action || "state");

  try {
    if (action === "chart") {
      const result = await loadCandles(String(body.timeframe || "5m"));
      return reply(result);
    }

    if (action === "state" || action === "quote") {
      const state = await buildState(db, member);
      return reply(action === "quote" ? { quote: state.quote, server_time: state.server_time } : state);
    }

    if (action === "place_order") {
      if (member.role !== "participant" || !member.participant_id) return reply({ error: "Participant invite required to trade" }, 403);
      const competition = await getCompetition(db);
      if (competition.status !== "running" || competition.is_paused) return reply({ error: "Trading is available only while the competition is running" }, 409);
      if (competition.ends_at && Date.now() >= new Date(competition.ends_at).getTime()) return reply({ error: "Competition deadline has passed" }, 409);
      const quote = await getQuote(db);
      if (!quote || quote.is_stale || Date.now() - new Date(quote.price_as_of).getTime() > 180000) return reply({ error: "Gold price is unavailable or stale. Try again when a fresh quote arrives." }, 503);
      const side = String(body.side || "").toUpperCase();
      const orderType = String(body.order_type || "MARKET").toUpperCase();
      const lots = Number(Number(body.lots).toFixed(2));
      if (!["BUY", "SELL"].includes(side)) return reply({ error: "Choose Buy or Sell" }, 400);
      if (!["MARKET", "LIMIT", "STOP"].includes(orderType)) return reply({ error: "Unsupported order type" }, 400);
      if (!Number.isFinite(lots) || lots < 0.01 || lots > 5) return reply({ error: "Lot size must be between 0.01 and 5.00" }, 400);
      const stop = body.stop_loss === "" || body.stop_loss == null ? null : number(body.stop_loss, "stop loss");
      const take = body.take_profit === "" || body.take_profit == null ? null : number(body.take_profit, "take profit");
      const trigger = body.trigger_price === "" || body.trigger_price == null ? null : number(body.trigger_price, "trigger price");
      const entry = side === "BUY" ? quote.ask : quote.bid;
      const referencePrice = orderType === "MARKET" ? entry : (trigger ?? entry);
      if (stop !== null && ((side === "BUY" && stop >= referencePrice) || (side === "SELL" && stop <= referencePrice))) return reply({ error: "Stop Loss must be below the planned Buy entry and above the planned Sell entry." }, 400);
      if (take !== null && ((side === "BUY" && take <= referencePrice) || (side === "SELL" && take >= referencePrice))) return reply({ error: "Take Profit must be above the planned Buy entry and below the planned Sell entry." }, 400);
      if (orderType !== "MARKET") {
        if (trigger === null || trigger <= 0) return reply({ error: "Enter a valid trigger price for a pending order." }, 400);
        if (orderType === "LIMIT" && ((side === "BUY" && trigger >= quote.mid) || (side === "SELL" && trigger <= quote.mid))) return reply({ error: "Limit price is on the wrong side of the current market." }, 400);
        if (orderType === "STOP" && ((side === "BUY" && trigger <= quote.mid) || (side === "SELL" && trigger >= quote.mid))) return reply({ error: "Stop price is on the wrong side of the current market." }, 400);
      }
      const { data: account, error: accountError } = await db.from("paper_accounts").select("balance").eq("participant_id", member.participant_id).single();
      if (accountError || !account) return reply({ error: "Paper account not found" }, 404);
      const { data: active } = await db.from("paper_trades").select("lots,status")
        .eq("participant_id", member.participant_id).in("status", ["open", "pending"]).is("archived_at", null);
      const reserved = (active || []).reduce((sum: number, t: any) => sum + quote.mid * contractSize * Number(t.lots) / leverage, 0);
      const required = quote.mid * contractSize * lots / leverage;
      if (reserved + required > Number(account.balance) * 0.95) return reply({ error: "Insufficient free margin for this lot size. Reduce volume." }, 400);
      const { data: inserted, error: insertError } = await db.from("paper_trades").insert({
        competition_id: competition.id, participant_id: member.participant_id, side, order_type: orderType,
        status: orderType === "MARKET" ? "open" : "pending", lots, trigger_price: orderType === "MARKET" ? null : trigger,
        entry_price: orderType === "MARKET" ? entry : null, stop_loss: stop, take_profit: take,
        spread_at_entry: quote.spread, opened_at: orderType === "MARKET" ? new Date().toISOString() : null,
      }).select("id,side,order_type,status,lots,entry_price,trigger_price").single();
      if (insertError) return reply({ error: "Could not create paper order: " + insertError.message }, 500);
      const state = await buildState(db, member);
      return reply({ ok: true, order: inserted, state });
    }

    if (action === "close_trade" || action === "cancel_order") {
      if (member.role !== "participant" || !member.participant_id) return reply({ error: "Participant invite required" }, 403);
      const { data: trade } = await db.from("paper_trades").select("*").eq("id", String(body.trade_id))
        .eq("participant_id", member.participant_id).is("archived_at", null).maybeSingle();
      if (!trade) return reply({ error: "Trade not found" }, 404);
      if (action === "cancel_order") {
        if (trade.status !== "pending") return reply({ error: "Only pending orders can be cancelled" }, 409);
        const { error } = await db.from("paper_trades").update({ status: "cancelled" }).eq("id", trade.id).eq("status", "pending");
        if (error) throw error;
      } else {
        if (trade.status !== "open") return reply({ error: "Only open positions can be closed" }, 409);
        const quote = await getQuote(db);
        if (!quote || quote.is_stale) return reply({ error: "A fresh gold quote is required to close a position." }, 503);
        await closeTrade(db, trade, quote);
      }
      return reply({ ok: true, state: await buildState(db, member) });
    }

    if (action === "admin") {
      if (member.role !== "admin") return reply({ error: "Administrator invite required" }, 403);
      const command = String(body.command || "");
      const competition = await getCompetition(db);
      const now = new Date();
      if (command === "start") {
        if (competition.status !== "draft") return reply({ error: "Only a draft challenge can be started." }, 409);
        const { data: accounts } = await db.from("paper_accounts").select("balance,starting_balance");
        if (!accounts || accounts.length !== 2 || accounts.some((a: any) => Number(a.balance) !== 50 || Number(a.starting_balance) !== 50)) return reply({ error: "Both accounts must have exactly $50 before starting." }, 409);
        const { data: active } = await db.from("paper_trades").select("id").in("status", ["open", "pending"]).is("archived_at", null);
        if ((active || []).length) return reply({ error: "Clear all open and pending trades before starting." }, 409);
        const { error } = await db.from("competitions").update({
          status: "running", starts_at: now.toISOString(), ends_at: new Date(now.getTime() + 48 * 3600 * 1000).toISOString(),
          completed_at: null, is_paused: false, paused_at: null,
        }).eq("id", competition.id);
        if (error) throw error;
      } else if (command === "pause") {
        if (competition.status !== "running" || competition.is_paused) return reply({ error: "Challenge is not running." }, 409);
        const { error } = await db.from("competitions").update({ is_paused: true, paused_at: now.toISOString() }).eq("id", competition.id);
        if (error) throw error;
      } else if (command === "resume") {
        if (competition.status !== "running" || !competition.is_paused || !competition.paused_at) return reply({ error: "Challenge is not paused." }, 409);
        const pausedMs = now.getTime() - new Date(competition.paused_at).getTime();
        const newEnd = new Date(new Date(competition.ends_at).getTime() + pausedMs).toISOString();
        const { error } = await db.from("competitions").update({ is_paused: false, paused_at: null, ends_at: newEnd }).eq("id", competition.id);
        if (error) throw error;
      } else if (command === "end") {
        if (competition.status !== "running") return reply({ error: "Only a running challenge can be ended." }, 409);
        const quote = await getQuote(db);
        if (!quote || quote.is_stale) return reply({ error: "A fresh gold quote is required to settle open positions." }, 503);
        const { data: open } = await db.from("paper_trades").select("*").eq("competition_id", competition.id).eq("status", "open").is("archived_at", null);
        for (const trade of open || []) await closeTrade(db, trade, quote, "admin_end");
        await db.from("paper_trades").update({ status: "cancelled" }).eq("competition_id", competition.id).eq("status", "pending").is("archived_at", null);
        const { error } = await db.from("competitions").update({ status: "completed", completed_at: now.toISOString(), is_paused: false, paused_at: null }).eq("id", competition.id);
        if (error) throw error;
      } else if (command === "reset") {
        const { error: archiveError } = await db.from("paper_trades").update({ archived_at: now.toISOString() })
          .eq("competition_id", competition.id).is("archived_at", null);
        if (archiveError) throw archiveError;
        const { error: accountsError } = await db.from("paper_accounts").update({ balance: 50, equity: 50, margin_used: 0, updated_at: now.toISOString() });
        if (accountsError) throw accountsError;
        const { error } = await db.from("competitions").update({
          status: "draft", starts_at: null, ends_at: null, completed_at: null, is_paused: false, paused_at: null,
        }).eq("id", competition.id);
        if (error) throw error;
      } else return reply({ error: "Unknown admin command" }, 400);
      return reply({ ok: true, state: await buildState(db, member) });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
});
