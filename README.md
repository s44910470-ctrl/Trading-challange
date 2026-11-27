# Zuperior Trading Arena

A private 1v1 demo trading challenge dashboard with MT5 monitoring connectors, leaderboard, trade history and rule alerts.

## Challenge configuration
- Two participants.
- Starting balance: $50 each.
- Maximum duration: 48 hours.
- Winner: highest final account balance after all open trades are closed.
- Broker server shown in the supplied account cards: `ZuperiorFX-Limited`.
- MT5 account type shown in the supplied cards: Demo.

## Tech stack
- Next.js 16 static export + React + TypeScript + Tailwind CSS.
- Supabase Auth, PostgreSQL, Realtime and Edge Functions.
- MQL5 Expert Advisor for MT5 desktop terminals.

## What is included
- Responsive blue/dark competition dashboard.
- Preview state showing both $50 starting balances before backend setup.
- Email magic-link sign-in.
- Live participant balances, equity, ranking and connector heartbeat state.
- MT5 closed-deal history table.
- Rule alert center and rules page.
- Supabase schema with Row Level Security.
- Edge Function protected by per-participant SHA-256 connector tokens.
- Monitoring-only MT5 EA (no trade execution functions).
- Setup, configuration and deployment instructions in `docs/SETUP.md`.

## Hosting

The frontend is configured for free GitHub Pages deployment through `.github/workflows/deploy-pages.yml`. Supabase hosts the database and ingestion Edge Function; GitHub Pages only serves the static web frontend. Follow `docs/SETUP.md` for the workflow variables and Supabase setup.

## Start locally
Requires a recent Node.js release supported by Next.js (Node 22 recommended).

```bash
cp .env.example .env.local
# Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Without Supabase environment variables, the app runs in preview mode. Preview figures are not live MT5 data.

## Security
The supplied screenshots contained demo account credentials. Change those passwords before using the accounts. This project does not need or store either MT5 password. Never commit account passwords, raw connector tokens, Supabase service-role keys, `.env.local`, or account screenshots.

See `docs/SETUP.md` for the complete setup sequence.
