-- Zuperior Trading Arena: initial Supabase schema
-- Run this entire file in Supabase SQL Editor. Never commit live connector tokens.
create extension if not exists pgcrypto;

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Zuperior Trading Arena - 1v1 Demo Challenge',
  status text not null default 'draft' check (status in ('draft','running','completed')),
  starting_balance numeric(18,2) not null default 50 check (starting_balance = 50),
  max_duration_minutes integer not null default 2880 check (max_duration_minutes = 2880),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  display_name text not null,
  expected_login text not null,
  expected_server text not null default 'ZuperiorFX-Limited',
  last_balance numeric(18,2),
  last_equity numeric(18,2),
  currency text not null default 'USD',
  last_seen timestamptz,
  is_connected boolean not null default false,
  starting_balance numeric(18,2) not null default 50,
  created_at timestamptz not null default now(),
  unique (competition_id, display_name)
);

create table if not exists public.connector_tokens (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'MT5 desktop connector',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.account_snapshots (
  id bigserial primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  balance numeric(18,2) not null,
  equity numeric(18,2) not null,
  margin numeric(18,2) not null default 0,
  free_margin numeric(18,2) not null default 0,
  currency text not null default 'USD',
  positions_count integer not null default 0,
  received_at timestamptz not null default now()
);

create table if not exists public.mt5_deals (
  id bigserial primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  deal_ticket text not null,
  order_ticket text,
  position_id text,
  symbol text,
  deal_type text,
  entry_type text,
  volume numeric(18,8),
  price numeric(18,10),
  profit numeric(18,2) not null default 0,
  commission numeric(18,2) not null default 0,
  swap numeric(18,2) not null default 0,
  comment text,
  deal_time_server bigint,
  is_balance_operation boolean not null default false,
  received_at timestamptz not null default now(),
  unique (participant_id, deal_ticket)
);

create table if not exists public.current_positions (
  id bigserial primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  position_ticket text not null,
  symbol text not null,
  position_type text not null,
  volume numeric(18,8) not null,
  price_open numeric(18,10),
  price_current numeric(18,10),
  stop_loss numeric(18,10),
  take_profit numeric(18,10),
  profit numeric(18,2),
  opened_at_server bigint,
  updated_at timestamptz not null default now(),
  unique (participant_id, position_ticket)
);

create table if not exists public.notifications (
  id bigserial primary key,
  participant_id uuid references public.participants(id) on delete cascade,
  severity text not null check (severity in ('info','warning','violation')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists participants_competition_idx on public.participants(competition_id);
create index if not exists deals_participant_time_idx on public.mt5_deals(participant_id, deal_time_server desc);
create index if not exists snapshots_participant_time_idx on public.account_snapshots(participant_id, received_at desc);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

alter table public.competitions enable row level security;
alter table public.participants enable row level security;
alter table public.connector_tokens enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.mt5_deals enable row level security;
alter table public.current_positions enable row level security;
alter table public.notifications enable row level security;

revoke all on public.competitions, public.participants, public.connector_tokens,
  public.account_snapshots, public.mt5_deals, public.current_positions, public.notifications
  from anon, authenticated;

-- Public dashboard views intentionally omit MT5 login IDs and connector secrets.
create or replace view public.leaderboard_public as
select p.id, p.display_name, p.last_balance, p.last_equity, p.starting_balance,
       p.last_seen, (p.is_connected and p.last_seen > now() - interval '2 minutes') as is_connected
from public.participants p
join public.competitions c on c.id = p.competition_id
where c.status <> 'completed';

create or replace view public.trade_feed_public as
select d.id, p.display_name, d.symbol, d.deal_type, d.entry_type, d.volume,
       d.price, (d.profit + d.commission + d.swap) as profit,
       to_timestamp(d.deal_time_server) as deal_time
from public.mt5_deals d join public.participants p on p.id = d.participant_id
join public.competitions c on c.id = p.competition_id
where c.status <> 'completed' and d.is_balance_operation = false;

create or replace view public.notifications_public as
select n.id, coalesce(p.display_name, 'System') as display_name,
       n.severity, n.title, n.message, n.created_at, false as acknowledged
from public.notifications n left join public.participants p on p.id = n.participant_id;

grant select on public.leaderboard_public, public.trade_feed_public, public.notifications_public to anon, authenticated;

-- Create one competition and two participants. Replace the two login placeholders with
-- each participant's MT5 numeric login. Never place MT5 passwords in SQL or website code.
-- insert into public.competitions (name) values ('Zuperior Trading Arena - 1v1') returning id;
-- insert into public.participants (competition_id,display_name,expected_login,expected_server)
-- values ('YOUR_COMPETITION_UUID','You','YOUR_MT5_LOGIN','ZuperiorFX-Limited'),
--        ('YOUR_COMPETITION_UUID','Friend','FRIEND_MT5_LOGIN','ZuperiorFX-Limited');
