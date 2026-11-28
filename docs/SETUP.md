# Zuperior Arena — Paper Trading Setup

## Current project
The existing Supabase project and GitHub Pages repository have been reused. The current competition remains in \`draft\`; the 48-hour clock has not been started. Existing MT5 connector/history tables were preserved. New paper-trading tables are isolated from those legacy records.

## Competition configuration
- Two participants: Trader 1 and Trader 2.
- $50 starting virtual capital per participant.
- 48-hour maximum duration.
- XAUUSD, 100 oz per lot, 1:1000 simulated leverage.
- Market, limit and stop orders; optional SL/TP.
- Dynamic spread: OANDA bid/ask when configured, otherwise simulated spread around the XAUS reference.
- Ranking by return percentage; drawdown is the tie-breaker.
- Participant trade history is private; leaderboard is shared.
- Administrator manually starts, pauses, resumes, ends and resets the round.

## Invite-only access
The backend function \`arena-api\` authenticates each request using an invite code supplied in the \`x-arena-code\` header. Only SHA-256 hashes are stored in the database. There are three separately generated codes: one for Trader 1, one for Trader 2, and one administrator code. Treat them like passwords. Do not commit them to GitHub or post them publicly. The website keeps the current code in session storage for the current browser tab.

If a code is exposed, rotate it by revoking the matching row in \`public.arena_credentials\` and inserting a fresh random token hash. Do not store raw invite codes in SQL, source code or notes.

## Price sources

### Default: XAUS spot reference
No API key is required. The backend fetches \`https://xaus.com/api/v1/spot?currency=USD&unit=oz&compact=1\` and reads \`spot_usd_oz\`. Spot data is cached by XAUS at approximately 60 seconds. The backend adds a bounded simulated spread around this reference. Do not poll faster than the upstream cache changes.

For the chart, the Arena candle mode aggregates XAUS intraday points into 5m, 15m, 1h and 4h bars. XAUS intraday data is sampled every five minutes; it cannot provide true 1m candles.

### Optional: OANDA v20 practice API
The Edge Function supports OANDA's account pricing endpoint and XAU_USD candles. It defaults to OANDA's practice environment if the following Edge Function secrets are configured:
- \`OANDA_API_TOKEN\` — OANDA v20 practice API bearer token.
- \`OANDA_ACCOUNT_ID\` — the corresponding OANDA practice account ID.
- \`OANDA_ENV\` — optional; use \`practice\`. Do not set to \`live\` for this virtual competition.

Add secrets in the Supabase Dashboard for the existing project under Edge Functions / Secrets. Keep them server-side; never use \`NEXT_PUBLIC_\` for these values. The backend prefers OANDA when both token and account ID are present, then falls back to XAUS if OANDA fails. Remove the secrets to return to the XAUS-only feed.

OANDA availability and account/API eligibility depend on region and the user's OANDA account. This is a price-data integration only; it does not submit real orders.

### TradingView chart
The Terminal has a TradingView chart embed for \`OANDA:XAUUSD\` plus a separate Arena candle chart. TradingView's charting libraries/widgets do not themselves provide a market-data API. The embedded chart is an independent visual reference; simulator order validation and fills use the server-side quote returned by OANDA (when configured) or XAUS. The two displays can differ because of source, cache and timing differences.

## Paper risk controls

The current participant profiles are created additively in `public.paper_risk_profiles`; audit events are stored in `public.paper_risk_events`. Both tables have RLS enabled and no direct access for anonymous or authenticated browser roles. The invite-authenticated `arena-api` Edge Function reads and writes them server-side.

Default risk profile for each existing participant:
- Maximum planned loss per trade: **2% of current account equity**.
- Daily loss cap: **5% of starting balance**.
- Maximum total loss from starting balance: **10%**.
- Maximum open positions plus pending orders: **3**.
- Maximum total active volume: **0.05 lots**.
- Maximum projected margin utilization: **90% of current equity**.
- Stop Loss is **required** on every new order.

Daily risk uses realized P&L from trades closed since 00:00 UTC plus current floating P&L. Daily reset boundary is UTC. The total-loss rule compares current equity with the account's starting balance; it is not a trailing peak-to-valley drawdown calculation.

The browser shows a pre-trade estimate, but the backend repeats the checks before inserting an order. A rejected risk check writes a private audit event. When daily or total loss limits are reached, new orders are blocked. Existing positions are not automatically liquidated by the risk lock; their configured SL/TP and normal close controls continue to apply when the quote refreshes.

Risk defaults are stored per participant and can be changed only through future authorized admin configuration work. Do not edit rows directly unless you understand the effect on the challenge rules.

## Trading simulator behaviour
- Market BUY fills at ask; market SELL fills at bid.
- Open BUY positions are marked at bid; SELL positions at ask.
- P&L = price difference × 100 oz × lots, with sign based on BUY/SELL.
- Margin estimate = gold mid-price × 100 oz × lots ÷ 1,000.
- Lot size range is 0.01 to 5.00. Available margin is checked before accepting an order.
- Limit and stop orders are evaluated when a new quote is refreshed.
- Stop loss and take profit are evaluated on quote refreshes; a manual close uses the latest fresh quote.
- Trade details are visible only to the participant whose invite code owns the trade.
- All balances and trades are simulated. There is no connection to a broker or MT5 for the new simulator.

This is a practice simulation, not an exchange-grade or tick-by-tick matching engine. Free reference price updates may be delayed, and an SL/TP can be crossed and then reversed between updates. Never use the displayed P&L as a broker statement or for real-money decisions.

## Start / pause / finish / reset
1. Sign in using the administrator invite code.
2. Confirm both virtual balances are $50, the correct two traders are present and the market price is fresh.
3. Open Competition → Admin controls → Start 48-hour challenge. This is the only action that starts the timer.
4. Pause/resume adjust the challenge timer; while paused, trading and automatic settlement are stopped.
5. End closes open positions against the latest fresh quote, cancels pending orders and completes the round.
6. Reset archives the current round's paper trades and resets both virtual account balances to $50. It does not delete prior records.

The challenge is intentionally left unstarted until you decide to begin it.

## GitHub Pages deployment
The workflow is \`.github/workflows/deploy-pages.yml\`. In GitHub repository Settings → Pages select GitHub Actions. Under Settings → Secrets and variables → Actions → Variables, set:
- \`NEXT_PUBLIC_SUPABASE_URL\` — the Supabase project URL.
- \`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\` — the public \`sb_publishable_...\` key.

These are public frontend values only. Never set a Supabase secret/service-role key here. Pushes to \`main\` run the static export workflow. Check Actions for a successful Pages deployment after changes.

## Install on mobile
Open the GitHub Pages website in Chrome on Android. Use the browser menu → Install app / Add to Home screen. On supported browsers, the install prompt also appears in the Settings page. The service worker caches the app shell only; invite authentication, prices, balances and trading require an internet connection.

## Legacy MT5 monitor
The existing \`mt5-ingest\` Edge Function, MT5 EA and old monitoring tables are retained for compatibility and historical data. The new Zuperior paper-trading UI does not require either participant to run MT5 or connect an Exness/broker account.
