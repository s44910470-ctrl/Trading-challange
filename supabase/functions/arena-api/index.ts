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
const cashRisk = (value: number) => "$" + Math.abs(value).toFixed(2);
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
async function getRiskProfile(db: any, participantId: string) {
  const { data, error } = await db.from("paper_risk_profiles").select("*")
    .eq("participant_id", participantId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: createError } = await db.from("paper_risk_profiles")
    .insert({ participant_id: participantId }).select("*").single();
  if (!createError && created) return created;
  // A parallel first request may have created the default row after our SELECT.
  const { data: retry, error: retryError } = await db.from("paper_risk_profiles").select("*")
    .eq("participant_id", participantId).maybeSingle();
  if (retryError || !retry) throw createError || retryError || new Error("Risk profile unavailable");
  return retry;
}

async function getRiskSnapshot(db: any, participantId: string, quote: Quote | null, competition: any) {
  const profile = await getRiskProfile(db, participantId);
  const { data: account, error: accountError } = await db.from("paper_accounts")
    .select("balance,starting_balance").eq("participant_id", participantId).single();
  if (accountError || !account) throw accountError || new Error("Paper account not found");

  const { data: active, error: activeError } = await db.from("paper_trades")
    .select("side,lots,entry_price,status,trigger_price")
    .eq("participant_id", participantId).in("status", ["open", "pending"]).is("archived_at", null);
  if (activeError) throw activeError;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: closedToday, error: dailyError } = await db.from("paper_trades")
    .select("realized_profit").eq("participant_id", participantId).eq("status", "closed")
    .is("archived_at", null).gte("closed_at", dayStart.toISOString());
  if (dailyError) throw dailyError;

  let floating = 0, marginUsed = 0, openPositions = 0, pendingOrders = 0, totalLots = 0;
  for (const trade of active || []) {
    const lots = Number(trade.lots || 0);
    totalLots += lots;
    marginUsed += (quote?.mid || 0) * contractSize * lots / leverage;
    if (trade.status === "pending") pendingOrders++;
    if (trade.status === "open") {
      openPositions++;
      if (quote && trade.entry_price != null) floating += unrealized(trade, quote);
    }
  }
  const balance = Number(account.balance);
  const startingBalance = Number(account.starting_balance);
  const equity = balance + floating;
  const dailyRealized = (closedToday || []).reduce((sum: number, row: any) => sum + Number(row.realized_profit || 0), 0);
  const dailyPnl = dailyRealized + floating;
  const totalPnl = equity - startingBalance;
  const dailyLossLimit = startingBalance * Number(profile.max_daily_loss_pct) / 100;
  const totalLossLimit = startingBalance * Number(profile.max_total_drawdown_pct) / 100;
  const blockedReasons: string[] = [];
  if (dailyPnl <= -dailyLossLimit) blockedReasons.push("Daily loss limit reached");
  if (totalPnl <= -totalLossLimit) blockedReasons.push("Maximum account drawdown reached");
  if (!profile.enabled) blockedReasons.push("Risk controls are disabled for this account");

  return {
    enabled: Boolean(profile.enabled),
    can_trade: blockedReasons.length === 0 && competition.status === "running" && !competition.is_paused,
    profile: {
      max_risk_per_trade_pct: Number(profile.max_risk_per_trade_pct),
      max_daily_loss_pct: Number(profile.max_daily_loss_pct),
      max_total_drawdown_pct: Number(profile.max_total_drawdown_pct),
      max_open_positions: Number(profile.max_open_positions),
      max_total_lots: Number(profile.max_total_lots),
      max_margin_pct: Number(profile.max_margin_pct),
      require_stop_loss: Boolean(profile.require_stop_loss),
    },
    metrics: {
      balance: Number(balance.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      floating_pnl: Number(floating.toFixed(2)),
      daily_pnl: Number(dailyPnl.toFixed(2)),
      daily_loss_limit: Number(dailyLossLimit.toFixed(2)),
      total_pnl: Number(totalPnl.toFixed(2)),
      total_loss_limit: Number(totalLossLimit.toFixed(2)),
      margin_used: Number(marginUsed.toFixed(2)),
      margin_pct: equity > 0 ? Number((marginUsed / equity * 100).toFixed(2)) : 0,
      open_positions: openPositions,
      pending_orders: pendingOrders,
      total_open_lots: Number(totalLots.toFixed(3)),
    },
    blocked_reasons: blockedReasons,
    day_reset_timezone: "UTC",
  };
}

async function recordRiskEvent(db: any, participantId: string, competitionId: string, eventType: string, message: string, details: Record<string, unknown> = {}) {
  try {
    await db.from("paper_risk_events").insert({
      participant_id: participantId,
      competition_id: competitionId,
      event_type: eventType,
      message,
      details,
    });
  } catch {
    // Risk rejection must still be returned even if audit storage is temporarily unavailable.
  }
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
  let me: any = null, myTrades: any[] = [], risk: any = null;
  if (member.participant_id) {
    me = leaderboard.find((p: any) => p.id === member.participant_id) || null;
    const { data: rows, error: tradeError } = await db.from("paper_trades").select("*")
      .eq("participant_id", member.participant_id).is("archived_at", null)
      .order("created_at", { ascending: false }).limit(100);
    if (tradeError) throw tradeError;
    myTrades = rows || [];
    risk = await getRiskSnapshot(db, member.participant_id, quote, competition);
  }
  return {
    role: member.role, me, leaderboard, myTrades, quote, risk,
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

function readSecretKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern);
      if (typeof keys.default === "string" && keys.default.length > 0) return keys.default;
    } catch {
      // Fall back to the legacy server-side key below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
function createAdminClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("apikey", key);
        // Modern sb_secret keys are API keys, not JWTs. Supabase requires them
        // on apikey only; remove the default Bearer header from supabase-js.
        if (key.startsWith("sb_secret_")) headers.delete("Authorization");
        return fetch(input, { ...init, headers });
      },
    },
  });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = readSecretKey();
  if (!url || !key) return reply({ error: "Backend is not configured" }, 500);
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return reply({ error: "Request too large" }, 413);
    body = JSON.parse(raw);
  } catch { return reply({ error: "Invalid JSON" }, 400); }
  const code = (req.headers.get("x-arena-code") || body.invite_code || "").trim();
  if (code.length < 32 || code.length > 128) return reply({ error: "Enter a valid invite code" }, 401);
  const db = createAdminClient(url, key);
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

    if (action === "journal_list") {
      if (member.role !== "participant" || !member.participant_id) return reply({ error: "Participant invite required" }, 403);
      const { data, error } = await db.from("trading_journal").select("*")
        .eq("participant_id", member.participant_id)
        .order("trade_date", { ascending: false }).limit(100);
      if (error) throw error;
      return reply({ entries: data || [] });
    }

    if (action === "journal_create" || action === "journal_update" || action === "journal_delete") {
      if (member.role !== "participant" || !member.participant_id) return reply({ error: "Participant invite required" }, 403);

      const journalId = String(body.id || "");
      if (action === "journal_delete") {
        if (!journalId) return reply({ error: "Journal entry ID is required" }, 400);
        const { data, error } = await db.from("trading_journal").delete()
          .eq("id", journalId).eq("participant_id", member.participant_id).select("id").maybeSingle();
        if (error) throw error;
        if (!data) return reply({ error: "Journal entry not found" }, 404);
        return reply({ ok: true, deleted_id: data.id });
      }

      if (action === "journal_update") {
        if (!journalId) return reply({ error: "Journal entry ID is required" }, 400);
        const { data: existing, error: findError } = await db.from("trading_journal").select("id")
          .eq("id", journalId).eq("participant_id", member.participant_id).maybeSingle();
        if (findError) throw findError;
        if (!existing) return reply({ error: "Journal entry not found" }, 404);
      }

      const title = String(body.title || "").trim();
      if (!title || title.length > 120) return reply({ error: "Title must be between 1 and 120 characters" }, 400);
      const direction = String(body.direction || "NO_TRADE").toUpperCase();
      if (!["BUY", "SELL", "NO_TRADE"].includes(direction)) return reply({ error: "Choose Buy, Sell or No trade" }, 400);
      const timeframe = String(body.timeframe || "5m");
      if (!["1m", "5m", "15m", "30m", "1h", "4h", "1d"].includes(timeframe)) return reply({ error: "Unsupported timeframe" }, 400);
      const outcome = String(body.outcome || "NO_TRADE").toUpperCase();
      if (!["WIN", "LOSS", "BREAKEVEN", "NO_TRADE"].includes(outcome)) return reply({ error: "Unsupported trade outcome" }, 400);
      const score = body.discipline_score === "" || body.discipline_score == null ? null : Number(body.discipline_score);
      if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) return reply({ error: "Discipline score must be from 1 to 5" }, 400);

      const nullablePrice = (value: unknown, label: string) => value === "" || value == null ? null : number(value, label);
      const rawMistakes = Array.isArray(body.mistakes) ? body.mistakes : String(body.mistakes || "").split(",");
      const mistakes = rawMistakes.map((v: unknown) => String(v).trim().slice(0, 60)).filter(Boolean).slice(0, 8);
      const chartImageUrl = String(body.chart_image_url || "").trim();
      if (chartImageUrl && (!/^https?:\/\//i.test(chartImageUrl) || chartImageUrl.length > 1000)) {
        return reply({ error: "Chart image must be a valid http(s) URL" }, 400);
      }

      let paperTradeId: string | null = body.paper_trade_id ? String(body.paper_trade_id) : null;
      let competitionId: string | null = null;
      if (paperTradeId) {
        const { data: linkedTrade, error: tradeError } = await db.from("paper_trades").select("id,competition_id")
          .eq("id", paperTradeId).eq("participant_id", member.participant_id).maybeSingle();
        if (tradeError) throw tradeError;
        if (!linkedTrade) return reply({ error: "Linked trade not found in your account" }, 404);
        competitionId = linkedTrade.competition_id;
      } else {
        const competition = await getCompetition(db);
        competitionId = competition.id;
      }

      const tradeDate = body.trade_date ? new Date(String(body.trade_date)) : new Date();
      if (!Number.isFinite(tradeDate.getTime())) return reply({ error: "Invalid journal date" }, 400);
      const payload = {
        participant_id: member.participant_id,
        competition_id: competitionId,
        paper_trade_id: paperTradeId,
        title,
        market: String(body.market || "XAUUSD").trim().slice(0, 30) || "XAUUSD",
        direction,
        timeframe,
        strategy: String(body.strategy || "").trim().slice(0, 100),
        setup: String(body.setup || "").trim().slice(0, 120),
        trade_date: tradeDate.toISOString(),
        entry_price: nullablePrice(body.entry_price, "entry price"),
        exit_price: nullablePrice(body.exit_price, "exit price"),
        stop_loss: nullablePrice(body.stop_loss, "stop loss"),
        take_profit: nullablePrice(body.take_profit, "take profit"),
        outcome,
        emotion: String(body.emotion || "").trim().slice(0, 80),
        discipline_score: score,
        mistakes,
        notes: String(body.notes || "").trim().slice(0, 6000),
        chart_image_url: chartImageUrl || null,
        updated_at: new Date().toISOString(),
      };

      const query = action === "journal_create"
        ? db.from("trading_journal").insert(payload).select("*").single()
        : db.from("trading_journal").update(payload).eq("id", journalId)
            .eq("participant_id", member.participant_id).select("*").single();
      const { data, error } = await query;
      if (error) throw error;
      return reply({ ok: true, entry: data });
    }

    if (action === "modify_trade") {
      if (member.role !== "participant" || !member.participant_id) return reply({ error: "Participant invite required" }, 403);
      const tradeId = String(body.trade_id || "");
      const { data: trade, error: tradeError } = await db.from("paper_trades").select("*")
        .eq("id", tradeId).eq("participant_id", member.participant_id).is("archived_at", null).maybeSingle();
      if (tradeError) throw tradeError;
      if (!trade || !["open", "pending"].includes(trade.status)) return reply({ error: "Only your open positions or pending orders can be modified" }, 404);

      const stop = body.stop_loss === "" || body.stop_loss == null ? null : number(body.stop_loss, "stop loss");
      const take = body.take_profit === "" || body.take_profit == null ? null : number(body.take_profit, "take profit");
      let trigger: number | null = null;
      let referencePrice = Number(trade.entry_price);
      if (trade.status === "pending") {
        const quote = await getQuote(db);
        if (!quote || quote.is_stale) return reply({ error: "A fresh gold quote is required to modify a pending order." }, 503);
        trigger = body.trigger_price === "" || body.trigger_price == null
          ? Number(trade.trigger_price)
          : number(body.trigger_price, "trigger price");
        if (!Number.isFinite(trigger) || trigger <= 0) return reply({ error: "Enter a valid pending-order price." }, 400);
        if (trade.order_type === "LIMIT" && ((trade.side === "BUY" && trigger >= quote.mid) || (trade.side === "SELL" && trigger <= quote.mid))) {
          return reply({ error: "Limit price is on the wrong side of the current market." }, 400);
        }
        if (trade.order_type === "STOP" && ((trade.side === "BUY" && trigger <= quote.mid) || (trade.side === "SELL" && trigger >= quote.mid))) {
          return reply({ error: "Stop price is on the wrong side of the current market." }, 400);
        }
        referencePrice = trigger;
      }
      if (stop !== null && ((trade.side === "BUY" && stop >= referencePrice) || (trade.side === "SELL" && stop <= referencePrice))) {
        return reply({ error: "Stop Loss must be below a Buy entry and above a Sell entry." }, 400);
      }
      if (take !== null && ((trade.side === "BUY" && take <= referencePrice) || (trade.side === "SELL" && take >= referencePrice))) {
        return reply({ error: "Take Profit must be above a Buy entry and below a Sell entry." }, 400);
      }
      const riskProfile = await getRiskProfile(db, member.participant_id);
      if (riskProfile.require_stop_loss && stop === null) {
        return reply({ error: "A Stop Loss is required by this account's risk profile." }, 400);
      }
      if (stop !== null) {
        const { data: account } = await db.from("paper_accounts").select("balance")
          .eq("participant_id", member.participant_id).single();
        const riskEquity = Math.max(0, Number(account?.balance || 0));
        const plannedRisk = Math.abs(referencePrice - stop) * contractSize * Number(trade.lots);
        const riskCap = riskEquity * Number(riskProfile.max_risk_per_trade_pct) / 100;
        if (plannedRisk > riskCap + 0.000001) {
          await recordRiskEvent(db, member.participant_id, trade.competition_id, "risk_per_trade_limit",
            "Position protection change exceeded the maximum risk per trade.",
            { trade_id: trade.id, planned_risk: plannedRisk, allowed_risk: riskCap });
          return reply({ error: "This Stop Loss would risk more than the account limit. Move it closer to entry." }, 400);
        }
      }
      const updatePayload = trade.status === "pending"
        ? { stop_loss: stop, take_profit: take, trigger_price: trigger }
        : { stop_loss: stop, take_profit: take };
      const { data: updated, error: updateError } = await db.from("paper_trades")
        .update(updatePayload)
        .eq("id", tradeId).eq("participant_id", member.participant_id)
        .in("status", ["open", "pending"]).select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return reply({ error: "Trade changed before the update completed" }, 409);
      return reply({ ok: true, state: await buildState(db, member) });
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
      const riskProfile = await getRiskProfile(db, member.participant_id);
      if (!riskProfile.enabled) {
        await recordRiskEvent(db, member.participant_id, competition.id, "risk_controls_disabled",
          "Order rejected because risk controls are disabled.");
        return reply({ error: "Trading is locked because risk controls are disabled for this account." }, 403);
      }
      if (riskProfile.require_stop_loss && stop === null) {
        await recordRiskEvent(db, member.participant_id, competition.id, "missing_stop_loss",
          "Order rejected because a Stop Loss is required.");
        return reply({ error: "Set a Stop Loss before placing this order. Your account requires protected trades." }, 400);
      }
      if (stop !== null) {
        const plannedRisk = Math.abs(referencePrice - stop) * contractSize * lots;
        const { data: equityAccount } = await db.from("paper_accounts")
          .select("balance").eq("participant_id", member.participant_id).single();
        const openRiskTrades = await db.from("paper_trades").select("side,lots,entry_price,status")
          .eq("participant_id", member.participant_id).eq("status", "open").is("archived_at", null);
        const openFloating = (openRiskTrades.data || []).reduce((sum: number, t: any) => {
          if (t.entry_price == null) return sum;
          return sum + unrealized(t, quote);
        }, 0);
        const equity = Math.max(0, Number(equityAccount?.balance || 0) + openFloating);
        const riskCap = equity * Number(riskProfile.max_risk_per_trade_pct) / 100;
        if (plannedRisk > riskCap + 0.000001) {
          await recordRiskEvent(db, member.participant_id, competition.id, "risk_per_trade_limit",
            "Order rejected because planned Stop Loss risk exceeds the per-trade limit.",
            { planned_risk: plannedRisk, allowed_risk: riskCap, lots, reference_price: referencePrice, stop_loss: stop });
          return reply({ error: "Planned loss at Stop Loss is " + cashRisk(plannedRisk) + "; account limit is " + cashRisk(riskCap) + ". Reduce volume or move the Stop Loss closer." }, 400);
        }
      }
      const { data: account, error: accountError } = await db.from("paper_accounts")
        .select("balance,starting_balance").eq("participant_id", member.participant_id).single();
      if (accountError || !account) return reply({ error: "Paper account not found" }, 404);
      const { data: active, error: activeError } = await db.from("paper_trades")
        .select("side,lots,status,entry_price").eq("participant_id", member.participant_id)
        .in("status", ["open", "pending"]).is("archived_at", null);
      if (activeError) throw activeError;
      const openCount = (active || []).filter((t: any) => t.status === "open").length;
      const pendingCount = (active || []).filter((t: any) => t.status === "pending").length;
      const activeCount = openCount + pendingCount;
      const activeLots = (active || []).reduce((sum: number, t: any) => sum + Number(t.lots), 0);
      const currentFloating = (active || []).filter((t: any) => t.status === "open")
        .reduce((sum: number, t: any) => sum + (t.entry_price == null ? 0 : unrealized(t, quote)), 0);
      const equity = Number(account.balance) + currentFloating;
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const { data: todayClosed, error: todayError } = await db.from("paper_trades")
        .select("realized_profit").eq("participant_id", member.participant_id).eq("status", "closed")
        .is("archived_at", null).gte("closed_at", today.toISOString());
      if (todayError) throw todayError;
      const dailyRealized = (todayClosed || []).reduce((sum: number, t: any) => sum + Number(t.realized_profit || 0), 0);
      const dailyPnl = dailyRealized + currentFloating;
      const dailyLossCap = Number(account.starting_balance) * Number(riskProfile.max_daily_loss_pct) / 100;
      const totalPnl = equity - Number(account.starting_balance);
      const totalLossCap = Number(account.starting_balance) * Number(riskProfile.max_total_drawdown_pct) / 100;
      if (dailyPnl <= -dailyLossCap) {
        await recordRiskEvent(db, member.participant_id, competition.id, "daily_loss_limit",
          "Order rejected because the daily loss limit has been reached.",
          { daily_pnl: dailyPnl, daily_loss_limit: dailyLossCap });
        return reply({ error: "Daily loss limit reached. New orders are locked until the next UTC day." }, 403);
      }
      if (totalPnl <= -totalLossCap) {
        await recordRiskEvent(db, member.participant_id, competition.id, "max_drawdown_limit",
          "Order rejected because the maximum account drawdown was reached.",
          { total_pnl: totalPnl, max_loss: totalLossCap });
        return reply({ error: "Maximum account drawdown reached. New orders are locked for this round." }, 403);
      }
      if (openCount >= Number(riskProfile.max_open_positions)) {
        await recordRiskEvent(db, member.participant_id, competition.id, "max_open_positions",
          "Order rejected because the maximum open position count was reached.",
          { open_positions: openCount, max_open_positions: riskProfile.max_open_positions });
        return reply({ error: "Maximum open position count reached." }, 400);
      }
      if (activeLots + lots > Number(riskProfile.max_total_lots) + 0.000001) {
        await recordRiskEvent(db, member.participant_id, competition.id, "max_total_lots",
          "Order rejected because total active lot exposure would exceed the limit.",
          { active_lots: activeLots, requested_lots: lots, max_total_lots: riskProfile.max_total_lots });
        return reply({ error: "Total active volume limit is " + Number(riskProfile.max_total_lots).toFixed(3) + " lots. Reduce volume or close an existing position." }, 400);
      }
      const reserved = (active || []).reduce((sum: number, t: any) => sum + quote.mid * contractSize * Number(t.lots) / leverage, 0);
      const required = quote.mid * contractSize * lots / leverage;
      const marginPct = equity > 0 ? (reserved + required) / equity * 100 : Infinity;
      if (marginPct > Number(riskProfile.max_margin_pct)) {
        await recordRiskEvent(db, member.participant_id, competition.id, "max_margin_limit",
          "Order rejected because projected margin utilization would exceed the risk profile.",
          { projected_margin_pct: marginPct, max_margin_pct: riskProfile.max_margin_pct });
        return reply({ error: "Projected margin usage is " + marginPct.toFixed(1) + "%; maximum allowed is " + Number(riskProfile.max_margin_pct).toFixed(1) + "%. Reduce volume." }, 400);
      }
      if (reserved + required > equity * 0.95) return reply({ error: "Insufficient free margin for this lot size. Reduce volume." }, 400);
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
