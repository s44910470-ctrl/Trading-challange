-- Version: 20261128065408
-- Add a participant-private trading journal. Requires the paper-trading engine migration.
create table if not exists public.trading_journal (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  competition_id uuid references public.competitions(id) on delete set null,
  paper_trade_id uuid references public.paper_trades(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  market text not null default 'XAUUSD' check (char_length(market) <= 30),
  direction text not null default 'NO_TRADE'
    check (direction in ('BUY', 'SELL', 'NO_TRADE')),
  timeframe text not null default '5m'
    check (timeframe in ('1m','5m','15m','30m','1h','4h','1d')),
  strategy text not null default '',
  setup text not null default '',
  trade_date timestamptz not null default now(),
  entry_price numeric(18,8),
  exit_price numeric(18,8),
  stop_loss numeric(18,8),
  take_profit numeric(18,8),
  outcome text not null default 'NO_TRADE'
    check (outcome in ('WIN','LOSS','BREAKEVEN','NO_TRADE')),
  emotion text not null default '',
  discipline_score smallint check (discipline_score between 1 and 5),
  mistakes text[] not null default '{}',
  notes text not null default '',
  chart_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trading_journal_participant_date_idx
  on public.trading_journal(participant_id, trade_date desc);
create index if not exists trading_journal_trade_idx
  on public.trading_journal(paper_trade_id)
  where paper_trade_id is not null;

alter table public.trading_journal enable row level security;
revoke all on public.trading_journal from anon, authenticated;
