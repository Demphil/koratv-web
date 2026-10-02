create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_live boolean not null default false,
  national_team boolean not null default false,
  home_team text,
  away_team text,
  competition_tier int not null default 3,
  priority_score int not null default 0,
  assigned_resource_id uuid,
  assignment_status text not null default 'pending',
  start_time timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  current_event_id uuid references public.events(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_assignment_status_check'
  ) then
    alter table public.events
      add constraint events_assignment_status_check
      check (assignment_status in ('pending', 'assigned', 'waiting'));
  end if;
end $$;

alter table public.events enable row level security;
alter table public.resources enable row level security;
revoke all on public.events from public, anon, authenticated;
revoke all on public.resources from public, anon, authenticated;
grant select, insert, update, delete on public.events to service_role;
grant select, insert, update, delete on public.resources to service_role;

create index if not exists events_live_priority_idx
  on public.events (is_live, priority_score desc, start_time asc);

create index if not exists resources_enabled_idx
  on public.resources (enabled, name);

-- KoraTV/FrajaTV production state: safe assignment table for today's matches.
-- This table stores no raw upstream URLs and no provider credentials.
create table if not exists public.match_resource_assignments (
  match_id text primary key,
  assignment_date date not null,
  provider_id text,
  requested_channel text,
  resolved_channel text,
  priority_score int not null default 0,
  status text not null check (status in ('ASSIGNED', 'WAITING')),
  updated_at timestamptz not null default now()
);

alter table public.match_resource_assignments enable row level security;
revoke all on public.match_resource_assignments from public, anon, authenticated;
grant select, insert, update, delete on public.match_resource_assignments to service_role;

create index if not exists match_resource_assignments_date_score_idx
  on public.match_resource_assignments (assignment_date, priority_score desc);

