# Zuperior Trading Arena — Setup

## What this repository contains
- `src/`: blue Next.js trading dashboard.
- `supabase/schema.sql`: database tables and read-only dashboard views.
- `supabase/functions/mt5-ingest/`: authenticated MT5 ingestion endpoint.
- `mt5/ZuperiorMonitor.mq5`: read-only Expert Advisor.
- `.github/workflows/deploy-pages.yml`: GitHub Pages build/deploy workflow.

## 1. Create Supabase project
Create a Supabase project. In SQL Editor, run the complete `supabase/schema.sql`.

Create the competition:
```sql
insert into public.competitions (name)
values ('Zuperior Trading Arena - 1v1 Demo Challenge')
returning id;
```

Use the returned UUID to create the two participants. Replace the login placeholders with each trader's numeric Exness MT5 demo login. The expected server must exactly match the server displayed in the Exness Personal Area (the current challenge uses Exness-MT5Trial16).
```sql
insert into public.participants
  (competition_id, display_name, expected_login, expected_server, starting_balance)
values
  ('YOUR_COMPETITION_UUID', 'You', 'YOUR_MT5_LOGIN', 'Exness-MT5Trial16', 50),
  ('YOUR_COMPETITION_UUID', 'Friend', 'FRIEND_MT5_LOGIN', 'Exness-MT5Trial16', 50)
returning id, display_name;
```

## 2. Create separate connector tokens
Generate a different long random token for each participant on your own computer. Example PowerShell:
```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```
Keep each raw token private. In SQL Editor, store only its SHA-256 hash. The current competition already has separate tokens stored for each participant; do not run the insert again unless rotating tokens. Use this template only when creating a new connection:
```sql
insert into public.connector_tokens (participant_id, token_hash, label)
values ('PARTICIPANT_UUID', encode(digest('PASTE_RAW_TOKEN_HERE', 'sha256'), 'hex'), 'Windows MT5 connector');
```
Never commit the raw tokens, MT5 passwords, service role key, or `.env.local` to GitHub.

## 3. Deploy the Edge Function
Install Supabase CLI, log in and link the project:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy mt5-ingest --no-verify-jwt
``
The function uses the project's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` runtime secrets. Supabase supplies these automatically to deployed Edge Functions.

## 4. Connect each MT5 desktop terminal
Use desktop MetaTrader 5 on Windows. The browser Web Terminal and mobile app cannot run this EA.

1. Open MetaEditor from MT5 (F4).
2. Create/open `MQL5/Experts/ZuperiorMonitor.mq5` and paste the EA source.
3. Compile with F7.
4. In MT5, open Tools → Options → Expert Advisors.
5. Enable “Allow WebRequest for listed URL” and add:
   `https://YOUR_PROJECT_REF.supabase.co`
6. Attach the EA to one chart per account.
7. Set `ApiBaseUrl` to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/mt5-ingest`.
8. Set that participant's unique `ConnectorToken`.
9. Repeat on the friend's MT5 using the friend's token.

Do not share MT5 passwords with the website or put them in EA inputs. The EA reads account information and history only; it does not send trading commands.

## 5. Deploy the website
This project is a static Next.js export suitable for GitHub Pages.
1. In repository Settings → Pages, select “GitHub Actions” as the source.
2. In Settings → Secrets and variables → Actions → Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = Supabase anon/public key
3. The workflow deploys when you push to `main`. The website refreshes database views every 10 seconds.

The dashboard uses public, read-only SQL views that omit MT5 login IDs and connector-token data. Keep the service-role key secret; it must only exist inside Supabase's server-side function environment.

## 6. Start and finish the challenge
Before starting, verify both MT5 connectors are reporting USD demo accounts, the balance starts at $50, and both accounts have no open positions. An administrator can start the competition in Supabase SQL Editor:
```sql
update public.competitions
set status = 'running', starts_at = now(), ends_at = now() + interval '48 hours'
where id = 'YOUR_COMPETITION_UUID' and status = 'draft';
``
At the deadline, close both accounts' open positions. When both are confirmed flat, finalize:
```sql
update public.competitions
set status = 'completed', completed_at = now()
where id = 'YOUR_COMPETITION_UUID' and status = 'running';
``

## Limitations and fairness notes
- Connector heartbeat requires the Windows MT5 terminal and EA to remain running with internet access. If a device is off, the dashboard shows it offline; it is not proof of cheating.
- MT5 history is synchronized on reconnect. Broker-side operations not present in the terminal's accessible history cannot be independently detected by this EA.
- The initial implementation flags reported balance/credit/charge operations for human review. It is not a tamper-proof anti-cheat system.
- Test both accounts with tiny demo trades before the official challenge.
- This is an independent demo leaderboard, not an official Zuperior broker integration.


## 7. GitHub Pages public configuration
In GitHub repository Settings → Secrets and variables → Actions → Variables, add:
- `NEXT_PUBLIC_SUPABASE_URL` = the project's API URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the project's `sb_publishable_...` key.

These are public browser credentials and are safe to put in `NEXT_PUBLIC_` variables. Never use the Supabase secret key or service-role key here. After saving variables, rerun the Pages workflow so Next.js embeds the public values in the exported site.
