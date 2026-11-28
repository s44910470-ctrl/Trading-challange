# Zuperior Trading Arena

A mobile-first, private two-player XAUUSD paper-trading competition. No broker account or MT5 terminal is required. Every account balance and trade is simulated with virtual funds.

## Competition defaults
- 2 participants: Trader 1 and Trader 2.
- Starting virtual balance: $50 each.
- Maximum round duration: 48 hours.
- Ranking: highest return percentage; maximum drawdown breaks ties.
- Contract size: 100 troy ounces per lot.
- Leverage: 1:1000.
- Order types: market, limit and stop.
- Optional stop loss and take profit.
- Private trade history and open positions; shared leaderboard.
- Administrator-controlled start, pause, resume, end and reset.
- The round remains in draft until the administrator explicitly starts it.

## Architecture
- Next.js 16 static export, React 19, TypeScript and Tailwind CSS.
- GitHub Pages hosts the responsive frontend and installable PWA shell.
- Supabase PostgreSQL stores the competition, invite credentials, virtual accounts and paper trades.
- Supabase Edge Function \`arena-api\` validates invite codes and processes paper orders server-side.
- A quote cache reduces calls to the public XAUS gold-price API to approximately one per minute.
- Optional OANDA v20 practice API pricing and candles can be configured with Edge Function secrets.
- An optional TradingView OANDA:XAUUSD chart embed is separate from the simulator's execution quote.

## Market-data policy
TradingView chart widgets and charting libraries do not supply a market-data API of their own; an external data provider must supply prices. The embedded TradingView chart displays OANDA:XAUUSD when available. Simulator fills use OANDA API pricing only when a practice token and account ID are securely configured on the Edge Function. Without those credentials, XAUS spot reference pricing is used. XAUS spot data is cached around 60 seconds, and its intraday endpoint contains five-minute samples. This is not a tick-by-tick broker feed.

## Repository areas
- \`src/app/\`: mobile-first terminal, leaderboard, paper order ticket and themes.
- \`public/manifest.json\`, \`public/sw.js\`, \`public/icon.svg\`: PWA assets.
- \`supabase/functions/arena-api/\`: invite-authenticated quote, chart, trade and admin API.
- \`supabase/functions/mt5-ingest/\`: retained legacy MT5 connector; it is not used by the new paper simulator.
- \`supabase/schema.sql\`: original competition schema.
- \`docs/SETUP.md\`: deployed project configuration and operating instructions.

## Hosting
The frontend uses GitHub Pages and Supabase's existing free project. There are no paid charting or trading services in the default configuration. Free-tier limits, project inactivity pausing, API fair-use limits and third-party availability still apply. The site cannot guarantee always-on price processing when nobody is accessing the free hosted application.

## Local development
Requires Node.js 22 or a current version supported by Next.js.
\`\`\`bash
cp .env.example .env.local
# Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev
\`\`\`

## Security
- Invite codes are stored as SHA-256 hashes in \`arena_credentials\`, not as plaintext.
- The browser only receives the public Supabase publishable key and the invite code entered by that user.
- Supabase service-role credentials and any OANDA API token must remain server-side.
- Never commit invite codes, API tokens, service-role keys, MT5 passwords or \`.env.local\`.
- The legacy MT5 monitor is not part of the paper-trading engine.

See [docs/SETUP.md](docs/SETUP.md) for setup, OANDA configuration and limitations.
