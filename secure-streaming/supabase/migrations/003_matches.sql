create table if not exists public.matches (
  id text primary key,
  match_id text unique,
  home_team text,
  away_team text,
  league text,
  kickoff_time timestamptz,
  channel text,
  source text not null default 'metascrape',
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists matches_kickoff_time_idx on public.matches (kickoff_time);
create index if not exists matches_channel_idx on public.matches (channel);
create index if not exists matches_active_idx on public.matches (active);

alter table public.matches enable row level security;
revoke all on public.matches from anon, authenticated;

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();
