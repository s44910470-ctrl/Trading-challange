# Zuperior Arena — Product & Engineering Roadmap

**Product direction:** Exness-inspired paper-trading terminal  
**Execution mode:** Paper trading only  
**Primary market at launch:** XAUUSD  
**Selected priorities:** Terminal, risk management, personal journal, analytics, AI assistant, mobile experience  
**Status:** Planning baseline created 28 November 2026

---

## 1. Product outcome

Turn Zuperior Arena from a private 1v1 XAUUSD challenge interface into a polished, mobile-first paper-trading terminal. The terminal should feel familiar to users of professional broker apps: watchlist, chart, trade ticket, positions, pending orders, history, account metrics and fast order management.

The simulator remains the source of truth for virtual balances and fills. The platform must never imply that a simulated order was sent to Exness, MT5 or another broker.

### Product principles

1. **Preserve current competition data.** Do not drop, recreate, truncate or reset the existing competition, participants, invite credentials, virtual accounts, paper trades or legacy MT5 tables as part of feature work.
2. **Additive database evolution.** Use versioned, reviewed migrations. Prefer adding columns/tables/indexes over changing or repurposing existing structures.
3. **Server-authoritative trading.** Validate orders, margin, risk limits, order states and realized P&L in the Edge Function/database—not only in the browser.
4. **Private by default.** Journal entries and individual trading records are scoped to the participant identified by their invite credential.
5. **Truthful market data.** Always identify the source and timestamp, show stale/delayed status, and block new orders when the execution quote is stale.
6. **Mobile-first interaction.** Important tasks must work with one thumb on a phone, with accessible touch targets and safe-area spacing.
7. **AI is advisory.** AI can explain data and review past decisions; it cannot place, modify or close trades.

---

## 2. Current baseline — preserve these capabilities

The repository and live Supabase project were inspected before writing this roadmap.

### Existing application

- Next.js 16 static export, React 19, TypeScript and Tailwind CSS.
- GitHub Pages hosting with an installable PWA shell.
- Supabase PostgreSQL and the invite-authenticated `arena-api` Edge Function.
- Separate administrator, Trader 1 and Trader 2 invite roles.
- Two participant accounts, currently configured with $50 virtual starting balances.
- A 48-hour competition lifecycle with draft, running, paused and completed states.
- Market, limit and stop paper orders.
- Server-side order validation, virtual margin checks and quote-based fills.
- Open positions, pending orders, close/cancel actions, floating/realized P&L and trade history.
- Optional stop-loss and take-profit protection, including modification support.
- Shared competition leaderboard and performance summary.
- XAUUSD chart display with TradingView embed and Arena candle view.
- Dark/light themes and mobile navigation.
- Private trading journal UI and API actions for list/create/update/delete.
- Journal records are stored in `public.trading_journal`; RLS is enabled and no public table access is granted.
- Existing `mt5-ingest` function and legacy MT5 monitoring tables are retained, but are not part of paper order execution.

### Current market-data limitations

- XAUUSD is the only supported simulator instrument at present.
- Execution pricing prefers OANDA v20 **practice pricing** only when server-side credentials are configured; otherwise it uses the XAUS spot reference.
- XAUS updates are cached at approximately one-minute intervals; they are not tick-by-tick prices.
- The TradingView OANDA:XAUUSD chart is an independent visual reference and can differ from the simulator execution quote.
- Pending orders and SL/TP are evaluated when the backend refreshes a quote. This is not an exchange-grade matching engine.

### Recently implemented

- [x] Additive risk profile and audit tables for both existing participants.
- [x] Default server-enforced risk checks: 2% per-trade loss, 5% daily loss, 10% total loss from starting balance, three active orders, 0.05 total lots, 90% projected margin utilization and required Stop Loss.
- [x] Pre-trade risk preview and participant Risk control centre with recent private risk events.
- [x] Risk checks repeated in the Edge Function before paper-order insertion.
- [ ] Add regression tests and concurrency-safe order placement before increasing exposure limits.

### Current live service status at roadmap creation

- `arena-api` Edge Function: active, version 5.
- The journal table exists in the live database and currently has no journal entries.
- The GitHub Pages workflow for the latest frontend baseline completed successfully.

---

## 3. Delivery sequence

The order below is dependency-driven. The terminal is the product direction; risk controls and data integrity must be dependable before advanced automation or AI is layered on top.

| Phase | Focus | Outcome | Priority |
|---|---|---|---|
| 0 | Data integrity and regression safety | Reproducible schema and protected existing data | P0 |
| 1 | Professional terminal foundation | Clear market workspace and dependable paper order lifecycle | P0 |
| 2 | Risk management | Server-enforced account and competition guardrails | P0 |
| 3 | Personal journal | Private, searchable, trade-linked journal with image uploads | P1 |
| 4 | Analytics | Accurate performance and behavioural reporting | P1 |
| 5 | AI trading assistant | Read-only, evidence-based reviews and coaching | P2 |
| 6 | Mobile excellence | App-like phone workflow and resilient PWA experience | P1 |

---

## 4. Implementation backlog

Each task is independently reviewable. A task is complete only when its acceptance criteria and regression checks pass.

### Phase 0 — Data integrity and engineering safety

#### ZA-001 — Reconcile schema and migration history
**Priority:** P0 · **Type:** Database

- Compare the live Supabase schema with `supabase/schema.sql` and repository migration history.
- Add a tracked migration for the existing journal table if it is not already represented in the repository.
- Record the current live schema as a reviewed baseline; do not blindly rerun the original schema against production.
- Ensure all future changes use additive migrations with clear rollback notes.
- Document which tables are legacy MT5 monitoring data and which belong to the paper simulator.

**Acceptance criteria**
- A fresh development database can be brought to the same application schema using the documented migration sequence.
- Existing live competition, participant, credential, account and trade rows are unchanged.
- The journal table, constraints, indexes and RLS configuration are represented in version control.
- No migration contains invite codes, service-role keys or provider secrets.

#### ZA-002 — Establish automated regression tests
**Priority:** P0 · **Type:** Quality

- Add a frontend typecheck/build check and an API test harness for the Edge Function.
- Cover invite role authorization, competition state transitions, order validation, margin checks, fill prices and P&L calculations.
- Add privacy tests proving one participant cannot read or edit another participant's trades or journal entries.
- Add migration checks for expected tables, constraints, indexes and RLS policies.

**Acceptance criteria**
- CI fails on a type error, failed test or production build failure.
- Tests cover valid and invalid market/limit/stop orders.
- Tests cover paused/completed competitions and stale quote rejection.
- Tests prove journal ownership checks for list, create, update and delete.

#### ZA-003 — Add operational observability
**Priority:** P1 · **Type:** Operations

- Add structured request IDs, action names, execution timing and safe error categories.
- Add an admin-only service health panel showing quote freshness, provider source, last successful refresh and backend status.
- Never log invite codes, journal contents, API keys or other secrets.

**Acceptance criteria**
- An administrator can distinguish unavailable, stale and fresh market data.
- A failed trade request can be correlated to a safe server log entry without exposing credentials.

---

### Phase 1 — Professional paper-trading terminal

#### ZA-101 — Finalize terminal information architecture
**Priority:** P0 · **Type:** Frontend

- Use one compact instrument header instead of a large standalone quote strip.
- Organize the workspace into chart, trade ticket and account/position context.
- Add clear areas for Watchlist, Chart, Trade, Positions, Pending Orders and Account.
- Keep the current competition navigation and administrator controls available.
- Use familiar professional trading conventions without copying Exness branding, assets or proprietary screens.

**Acceptance criteria**
- The main trading task is reachable without excessive scrolling on common desktop and phone sizes.
- The active instrument, quote source and delayed/fresh state are always unambiguous.
- Existing Performance, Positions, History, Journal, Arena and Settings views remain accessible.

#### ZA-102 — Quote and instrument data contract
**Priority:** P0 · **Type:** Backend / Market data

- Introduce a typed instrument metadata model: symbol, display name, contract size, lot min/max/step, price precision, tick size, trading availability and provider symbol.
- Keep XAUUSD as the only enabled instrument until a second source is verified.
- Return bid, ask, spread, mid, provider, source timestamp, received timestamp and stale status consistently.
- Separate chart display data from execution prices in the API response.
- Add provider health and a safe fallback policy; never silently label delayed reference data as live broker data.

**Acceptance criteria**
- Every quote displays its source and timestamp.
- New orders are rejected server-side when the execution quote is missing or stale.
- Current XAUUSD contract and leverage assumptions remain unchanged unless explicitly approved.

#### ZA-103 — Upgrade the order ticket
**Priority:** P0 · **Type:** Frontend / Backend

- Present Market, Limit and Stop order types in a compact ticket.
- Show volume, estimated margin, entry/reference price, spread and optional SL/TP before submission.
- Display a confirmation summary before the user submits an order.
- Add clear validation for pending-order direction, minimum/maximum volume and risk constraints.
- Keep the existing server-side order checks as the authoritative validation layer.

**Acceptance criteria**
- UI preview and server result use the same instrument metadata and quote snapshot identifier.
- Invalid order direction, price, volume or margin is rejected with a helpful message.
- Completed round and paused round states disable submission and are also rejected by the backend.

#### ZA-104 — Complete order and position management
**Priority:** P0 · **Type:** Backend / Frontend

- Standardize order states and transitions: pending, open, closed and cancelled.
- Add partial close with an immutable execution/close record for each partial fill.
- Add safe modification of SL/TP and pending order trigger prices.
- Add close-all with a confirmation and a clear result summary.
- Add sorting and filtering for open positions and pending orders.
- Preserve a complete audit trail; never overwrite the only record of a partial close.

**Acceptance criteria**
- Partial closes reduce remaining lots and realize P&L exactly once.
- The sum of partial realized P&L plus final close P&L matches the position's total realized result.
- Double-submit/retry cannot close the same quantity twice.
- Every order action appears in the participant's private history.

#### ZA-105 — Add terminal watchlist (XAUUSD-first)
**Priority:** P1 · **Type:** Frontend

- Create a watchlist shell with the active XAUUSD instrument.
- Show market state, bid/ask, spread and quote freshness.
- Design the instrument selector around the metadata model, but do not enable unverified symbols.
- Allow watchlist pinning and recently viewed symbols.

**Acceptance criteria**
- XAUUSD works end to end.
- Unsupported symbols are visibly disabled rather than displaying fabricated prices.
- Adding a new instrument requires a verified data source and tested contract metadata.

---

### Phase 2 — Server-enforced risk management

#### ZA-201 — Create configurable risk profiles
**Priority:** P0 · **Type:** Database / Backend

- Add an additive risk-profile table scoped to competition and, where needed, participant.
- Configure maximum risk per trade, daily loss, overall drawdown, open positions, total lots, margin utilization and allowed trading state.
- Preserve the current $50 starting balance, 1:1000 simulated leverage, 100 oz contract and 48-hour round unless an administrator changes the competition configuration through an explicit supported workflow.

**Acceptance criteria**
- Existing accounts receive safe default limits matching the current competition rules.
- Profile changes are logged with actor, timestamp and old/new values.
- A missing profile fails safely to documented defaults.

#### ZA-202 — Enforce limits on the server
**Priority:** P0 · **Type:** Backend

- Evaluate available equity, realized and floating P&L, used margin and existing exposure before accepting an order.
- Enforce daily loss and maximum drawdown using a documented timezone and reset boundary.
- Reject orders that exceed risk limits even if the browser submits a handcrafted request.
- Add an account lock state and explicit admin unlock procedure.
- Record risk violations in an append-only audit table.

**Acceptance criteria**
- Risk checks run server-side for every new order and relevant modification.
- Concurrent order requests cannot bypass limits; validation and reservation must be transaction-safe.
- A breached account cannot place further orders until the configured policy permits it.
- All violations are visible to the affected trader and authorized administrator.

#### ZA-203 — Add pre-trade risk calculator
**Priority:** P1 · **Type:** Frontend

- Show planned loss at SL, potential reward at TP, risk/reward ratio, required margin and percentage of equity at risk.
- Recalculate when side, lots, entry, SL or TP changes.
- Warn when no SL is set or risk is above the user's configured preference.

**Acceptance criteria**
- Preview figures match the server's contract-size and P&L calculation.
- The calculator is clearly marked as an estimate for a simulated instrument.

---

### Phase 3 — Personal trading journal

#### ZA-301 — Finish the journal data model and ownership controls
**Priority:** P1 · **Type:** Database / Backend

- Preserve the existing `trading_journal` table and its rows.
- Keep RLS enabled and no public access to the table.
- Enforce participant ownership in every journal API action.
- Add optional links to paper trades and preserve journal entries when a trade is archived or reset.
- Add additive fields only when a reviewed feature requires them.

**Acceptance criteria**
- Trader 1 cannot read, update or delete Trader 2's journal.
- Admin has no implicit access to private journal contents.
- Competition reset archives paper trades but does not delete personal journal notes.

#### ZA-302 — Add private chart image uploads
**Priority:** P1 · **Type:** Storage / Frontend

- Create a private Supabase Storage bucket for journal images.
- Use signed URLs and participant-scoped storage paths.
- Validate file size, MIME type and image dimensions.
- Migrate from URL-only attachments without breaking existing `chart_image_url` entries.

**Acceptance criteria**
- A participant can upload and view their own chart image.
- Another participant cannot retrieve the image using a guessed path.
- Existing URL attachments continue to work during the transition.

#### ZA-303 — Add journal workflows
**Priority:** P1 · **Type:** Frontend

- Add calendar, date range, outcome, strategy and instrument filters.
- Add journal templates for pre-trade plan, post-trade review and no-trade review.
- Link an existing paper trade to a journal entry and prefill available values.
- Offer a prompt to journal a closed trade without forcing the user to write a review.
- Add search, edit and delete confirmation.

**Acceptance criteria**
- A journal entry can be created, edited, filtered, opened and deleted on desktop and phone.
- Linking a trade never exposes that trade to another participant.
- The journal remains independent of competition resets.

---

### Phase 4 — Performance analytics

#### ZA-401 — Define authoritative performance metrics
**Priority:** P1 · **Type:** Backend

- Define formulas for win rate, profit factor, expectancy, average win/loss, average R, max drawdown, streaks and net return.
- Explicitly distinguish balance, equity, realized P&L and floating P&L.
- Exclude cancelled pending orders from trade-result metrics.
- Decide how partial closes and breakeven trades are counted.
- Store calculation definitions and test cases alongside the API.

**Acceptance criteria**
- Same data produces identical metrics across API and UI.
- Empty/zero-denominator cases return a safe null or display state, never Infinity/NaN.
- Metrics reconcile with the underlying paper trade ledger.

#### ZA-402 — Add equity history and analytics dashboard
**Priority:** P1 · **Type:** Database / Backend / Frontend

- Add a new paper-equity snapshot stream; do not repurpose legacy MT5 `account_snapshots`.
- Record snapshots at controlled intervals and on important account events.
- Add daily/weekly/monthly P&L, equity curve, drawdown curve, trade distribution and strategy breakdown.
- Add session-of-day analytics only when timestamp quality is sufficient.

**Acceptance criteria**
- Equity history is reproducible and clearly identifies snapshot gaps.
- Historical charts never invent points where no snapshot exists.
- Dashboard totals reconcile to the paper account and trade history.

#### ZA-403 — Export reports
**Priority:** P2 · **Type:** Frontend

- Export a participant's own trade history and journal to CSV.
- Add printable performance summary/PDF as a later enhancement.
- Never include another participant's private trade or journal data.

---

### Phase 5 — AI trading assistant (read-only)

#### ZA-501 — Define AI data boundary and cost controls
**Priority:** P2 · **Type:** Backend / Security

- AI requests use server-generated summaries of the current participant's own trades, metrics and journal entries.
- Do not send invite codes, service-role keys or another participant's private records to the AI provider.
- Store provider keys as server-side secrets only.
- Add per-user rate limits, token/input caps, retention rules and a monthly cost budget.
- Make AI use optional and disclose which user data is used.

**Acceptance criteria**
- AI endpoints are authenticated through the existing invite identity.
- The browser never receives an AI provider secret.
- Requests are rejected when the configured budget or rate limit is reached.

#### ZA-502 — Add journal and performance review
**Priority:** P2 · **Type:** AI / Backend

- Summarize recurring setups, best/worst conditions, common execution mistakes and discipline trends.
- Link every insight to source trades or journal entries.
- Distinguish calculated facts from AI-generated interpretations.
- Allow the trader to correct or dismiss an insight.

**Acceptance criteria**
- Every numeric statement can be traced to a server-side metric.
- The assistant clearly states when there is insufficient data.
- The assistant does not guarantee profits or invent missing trade details.

#### ZA-503 — Add AI market explanation (optional)
**Priority:** P2 · **Type:** AI

- Summarize current quote context and user-selected chart notes.
- Explain indicators and market structure in educational language.
- Do not generate unverified real-time claims from the independent TradingView embed.
- No automatic signals or trade execution in this phase.

**Acceptance criteria**
- AI content is labelled analysis/education, not a broker quote or guaranteed signal.
- The assistant cannot call place/modify/close order actions.

---

### Phase 6 — Mobile terminal excellence

#### ZA-601 — Mobile trading layout
**Priority:** P1 · **Type:** Frontend

- Add a compact watchlist drawer and an instrument/chart workspace.
- Use a bottom trade ticket or accessible order sheet that does not cover chart controls.
- Add swipe-safe tabs for Trade, Positions, History, Journal and Performance.
- Respect Android/iOS safe areas, keyboard resizing and portrait/landscape orientation.
- Keep the desktop layout independently usable.

**Acceptance criteria**
- No horizontal overflow at 320px, 360px, 390px and 430px widths.
- Buy/Sell and order-type controls remain reachable with the keyboard open.
- Chart fullscreen can be exited with a visible control and device back navigation where supported.

#### ZA-602 — PWA reliability and alerts
**Priority:** P1 · **Type:** Frontend / Operations

- Improve update handling so an old service worker does not keep a stale frontend bundle.
- Add connection and quote freshness indicators.
- Add opt-in browser notifications for order fills, SL/TP settlement and competition events.
- Keep notification permissions optional and explain unsupported browser behaviour.

**Acceptance criteria**
- New deployments prompt or recover cleanly from stale cached assets.
- Notifications are sent only for the signed-in participant's permitted events.
- Trading remains online-only; cached pages never pretend to execute orders offline.

---

## 5. Non-goals for this roadmap

- Real-money trading or real Exness order execution.
- Copy trading or account mirroring.
- Claims of tick-by-tick or exchange-grade pricing using the current free reference feed.
- Automatic AI trade placement.
- Enabling additional symbols before a verified provider, contract specification and execution test exist.
- Rebuilding the competition engine from scratch.
- Replacing the existing invite system or rotating credentials as part of feature development.

A future, separately approved broker integration would need its own security review, user consent, credential vault, broker-specific order lifecycle, reconciliation and explicit separation from paper accounts.

---

## 6. Definition of done

A feature is complete only when all applicable checks pass:

- TypeScript checks and production build pass in GitHub Actions.
- Database changes are versioned, additive and verified against the live schema.
- Server-side authorization and participant isolation are tested.
- Paper order calculations reconcile with account and trade history.
- Desktop and mobile workflows are tested at representative viewport sizes.
- Loading, error, stale data and empty states are designed.
- No secrets or private participant data are added to frontend bundles or logs.
- README and setup documentation are updated when operating behaviour changes.
- Deployment is green before the change is described as live.

---

## 7. Recommended first implementation sprint

Start with these tasks in order:

1. **ZA-001** — Reconcile live schema and repository migrations.
2. **ZA-002** — Add regression tests for current paper-trading flows.
3. **ZA-101** — Finalize the terminal workspace layout and navigation.
4. **ZA-102** — Standardize quote/instrument metadata and stale-price indicators.
5. **ZA-103** — Complete the order ticket preview and validation.
6. **ZA-104** — Implement partial close with an auditable close ledger.
7. **ZA-201 / ZA-202** — Add server-enforced risk configuration and limits.

Do not start multi-asset expansion or AI execution features until these foundations are stable.

---

## 8. Existing data and deployment guardrails

- Supabase project: existing **Trading challenge** project.
- GitHub repository: `s44910470-ctrl/Trading-challange`.
- Frontend deploy: GitHub Pages workflow on `main`.
- Backend: existing Supabase Edge Function `arena-api`.
- Preserve current `arena_credentials` hashes; never put plaintext invite codes in this roadmap.
- Preserve existing competition and participant IDs, paper account balances, paper trades and legacy MT5 monitoring tables.
- Use new migrations for new risk, snapshot, storage metadata or audit structures.
- Before any destructive or reset operation, require an explicit administrator action and a verified backup/recovery plan.
