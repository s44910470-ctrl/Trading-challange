import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
const hash = async (s: string) => {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
};
const n = (v: unknown, name: string) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error("Invalid " + name);
  return x;
};
async function notifyOnce(db: any, participantId: string, severity: "info" | "warning" | "violation",
  title: string, message: string, dedupeKey: string) {
  const { error } = await db.from("notifications").upsert({
    participant_id: participantId, severity, title, message, dedupe_key: dedupeKey
  }, { onConflict: "participant_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error("Could not save notification: " + error.message);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ error: "Backend is not configured" }, 500);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 32) return reply({ error: "Connector token missing" }, 401);

  let payload: any;
  try {
    const raw = await req.text();
    if (raw.length > 700_000) return reply({ error: "Payload too large" }, 413);
    payload = JSON.parse(raw);
  } catch { return reply({ error: "Invalid JSON" }, 400); }
  if (payload?.schema_version !== 1 || !payload?.account || !Array.isArray(payload.positions) || !Array.isArray(payload.deals)) return reply({ error: "Unsupported payload schema" }, 400);
  if (payload.positions.length > 150 || payload.deals.length > 500) return reply({ error: "Too many records" }, 413);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: connector } = await db.from("connector_tokens").select("participant_id").eq("token_hash", await hash(token)).is("revoked_at", null).maybeSingle();
  if (!connector) return reply({ error: "Invalid or revoked connector token" }, 401);
  const { data: p } = await db.from("participants").select("id,competition_id,expected_login,expected_server,display_name,starting_balance,last_seen").eq("id", connector.participant_id).single();
  if (!p) return reply({ error: "Participant missing" }, 404);
  const account = payload.account;
  if (String(account.login) !== p.expected_login || String(account.server) !== p.expected_server) return reply({ error: "Account does not match assigned participant" }, 403);
  if (account.is_demo !== true || String(account.currency).toUpperCase() !== "USD") return reply({ error: "Only USD demo accounts are accepted" }, 403);

  const { data: competition } = await db.from("competitions").select("status,starts_at,ends_at").eq("id", p.competition_id).single();
  if (!competition || competition.status === "completed") return reply({ error: "Competition is not accepting updates" }, 409);
  const now = new Date();
  if (competition.status === "running" && competition.ends_at && now > new Date(competition.ends_at)) {
    await notifyOnce(db, p.id, "violation", "Update received after deadline",
      "MT5 connector sent data after the competition deadline.", "connector-update-after-deadline");
    return reply({ error: "Competition deadline has passed" }, 409);
  }

  let balance: number, equity: number;
  try { balance = n(account.balance, "balance"); equity = n(account.equity, "equity"); }
  catch (e) { return reply({ error: (e as Error).message }, 400); }
  if (balance < 0 || equity < 0) return reply({ error: "Invalid account totals" }, 400);
  if (!p.last_seen && Math.abs(balance - Number(p.starting_balance ?? 50)) > 0.01) {
    await notifyOnce(db, p.id, "violation", "Starting balance mismatch",
      `First MT5 snapshot reported ${balance.toFixed(2)}; agreed starting balance is ${Number(p.starting_balance ?? 50).toFixed(2)}. Review before starting.`,
      "initial-start-balance");
  }

  const deals = payload.deals.map((d: any) => ({
    participant_id: p.id, deal_ticket: String(d.ticket), order_ticket: String(d.order_ticket ?? ""),
    position_id: String(d.position_id ?? ""), symbol: String(d.symbol ?? "").slice(0, 40),
    deal_type: String(d.deal_type ?? "").slice(0, 40), entry_type: String(d.entry_type ?? "").slice(0, 40),
    volume: n(d.volume ?? 0, "volume"), price: n(d.price ?? 0, "price"),
    profit: n(d.profit ?? 0, "profit"), commission: n(d.commission ?? 0, "commission"),
    swap: n(d.swap ?? 0, "swap"), comment: String(d.comment ?? "").slice(0, 120),
    deal_time_server: n(d.time ?? 0, "deal time"), is_balance_operation: d.is_balance_operation === true
  }));
  const officialStartUtc = competition.starts_at
    ? Math.floor(new Date(competition.starts_at).getTime() / 1000)
    : null;
  // Only balance operations inside the active competition window are rule violations.
  // Older history is synced for audit but should not be treated as challenge cheating.
  if (competition.status === "running" && officialStartUtc !== null) {
    for (const deal of deals.filter((d: any) =>
      d.is_balance_operation && d.deal_time_server >= officialStartUtc
    )) {
      await notifyOnce(db, p.id, "violation", "Balance operation detected",
        `MT5 history reported a balance/credit/charge operation (deal ${deal.deal_ticket}). Admin review is required.`,
        `balance-operation-${deal.deal_ticket}`);
    }
  }
  if (competition.status === "running" && competition.starts_at) {
    const start = Math.floor(new Date(competition.starts_at).getTime() / 1000);
    if (deals.some((d: any) => d.deal_time_server > 0 && d.deal_time_server < start)) {
      await notifyOnce(db, p.id, "warning", "Historical deals synchronized",
        "Older MT5 history was received. Check broker-server time against the official challenge window before counting these deals.",
        "historical-deals-sync");
    }
  }

  const positions = payload.positions.map((x: any) => ({
    participant_id: p.id, position_ticket: String(x.ticket), symbol: String(x.symbol).slice(0, 40),
    position_type: String(x.type).slice(0, 20), volume: n(x.volume, "position volume"),
    price_open: n(x.price_open, "open price"), price_current: n(x.price_current, "current price"),
    stop_loss: n(x.stop_loss ?? 0, "stop loss"), take_profit: n(x.take_profit ?? 0, "take profit"),
    profit: n(x.profit ?? 0, "position profit"), opened_at_server: n(x.time ?? 0, "open time")
  }));

  const { error: snapError } = await db.from("account_snapshots").insert({
    participant_id: p.id, balance, equity, margin: n(account.margin ?? 0, "margin"),
    free_margin: n(account.free_margin ?? 0, "free margin"), currency: "USD", positions_count: positions.length
  });
  if (snapError) return reply({ error: "Could not save account snapshot" }, 500);
  await db.from("participants").update({ last_balance: balance, last_equity: equity, last_seen: now.toISOString(), is_connected: true }).eq("id", p.id);

  await db.from("current_positions").delete().eq("participant_id", p.id);
  if (positions.length) {
    const { error } = await db.from("current_positions").insert(positions);
    if (error) return reply({ error: "Could not synchronize open positions" }, 500);
  }
  if (deals.length) {
    const { error } = await db.from("mt5_deals").upsert(deals, { onConflict: "participant_id,deal_ticket", ignoreDuplicates: true });
    if (error) return reply({ error: "Could not synchronize deal history" }, 500);
  }

  return reply({ ok: true, participant: p.display_name, balance, equity, open_positions: positions.length, deals_received: deals.length, received_at: now.toISOString() });
});
