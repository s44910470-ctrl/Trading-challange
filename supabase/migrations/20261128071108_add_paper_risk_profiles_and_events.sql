-- Version: 20261128071108
-- Add server-only risk profiles and a private audit trail for the paper simulator.
create table if not exists public.paper_risk_profiles (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  max_risk_per_trade_pct numeric(6,3) not null default 2.0
    check (max_risk_per_trade_pct > 0 and max_risk_per_trade_pct <= 100),
  max_daily_loss_pct numeric(6,3) not null default 5.0
    check (max_daily_loss_pct > 0 and max_daily_loss_pct <= 100),
  max_total_drawdown_pct numeric(6,3) not null default 10.0
    check (max_total_drawdown_pct > 0 and max_total_drawdown_pct <= 100),
  max_open_positions integer not null default 3
    check (max_open_positions between 1 and 100),
  max_total_lots numeric(10,3) not null default 0.05
    check (max_total_lots > 0 and max_total_lots <= 100),
  max_margin_pct numeric(6,3) not null default 90.0
    check (max_margin_pct > 0 and max_margin_pct <= 100),
  require_stop_loss boolean not null default true,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_risk_events (
  id bigserial primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  competition_id uuid references public.competitions(id) on delete set null,
  event_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists paper_risk_events_participant_time_idx
  on public.paper_risk_events(participant_id, created_at desc);

alter table public.paper_risk_profiles enable row level security;
alter table public.paper_risk_events enable row level security;
revoke all on public.paper_risk_profiles, public.paper_risk_events from anon, authenticated;

insert into public.paper_risk_profiles (participant_id)
select id from public.participants
on conflict (participant_id) do nothing;
