# Supabase migration notes

This folder currently tracks the two recent additive migrations:
- `20261128065408_add_private_trading_journal.sql`
- `20261128071108_add_paper_risk_profiles_and_events.sql`

The live Supabase project also reports these earlier migrations:

| Version | Name |
|---|---|
| 20261128044151 | add_xau_paper_trading_engine |
| 20261128044636 | add_atomic_paper_balance_update |
| 20261128044646 | make_paper_trade_closes_atomic |
| 20261128045315 | grant_arena_backend_table_access |

The SQL source for those four original engine migrations is not currently tracked in this repository. Before bootstrapping a completely new Supabase project from Git, export/review and add those original migrations in order. The original `supabase/schema.sql` is not a complete replacement for the live paper-trading engine schema.

The two migrations in this folder were applied to the existing live project and are recorded in its migration history. Do not rerun them as ad-hoc SQL on that project, and do not reset or recreate any live tables. Future schema changes should be new additive migrations with a matching entry in the live Supabase migration history.

Never place invite codes, provider credentials, publishable/secret keys or service-role keys in migration files.
