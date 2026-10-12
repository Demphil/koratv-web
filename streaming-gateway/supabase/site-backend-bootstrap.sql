-- Bootstrap only the website tables in an empty Supabase project.
-- Application accounts, wallets, forecasts, and auth data are excluded.
begin;

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  original_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  quality_variants jsonb default '[]'::jsonb
);
create table public.matches (
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
create table public.channel_language_alternatives (
  id bigserial primary key,
  base_channel_name text not null,
  language text not null check (language in ('fr', 'en')),
  channel_name text not null,
  source text not null default 'gemini',
  match_id text,
  confidence numeric not null default 0,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, language)
);
create table public.stream_access_audit (
  id bigserial primary key,
  channel_id uuid references public.channels(id) on delete set null,
  channel_name text not null,
  ip_hash text,
  user_agent text,
  event text not null,
  created_at timestamptz not null default now()
);
create table public.match_resource_assignments (
  match_id text primary key,
  assignment_date date not null,
  provider_id text,
  requested_channel text,
  resolved_channel text,
  priority_score int not null default 0,
  status text not null check (status in ('ASSIGNED', 'WAITING')),
  updated_at timestamptz not null default now()
);
create table public.live_matches (
  id text primary key,
  channel_id text not null,
  is_streaming_active boolean not null default false
);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;
create trigger channels_set_updated_at before update on public.channels
  for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();
create trigger channel_language_alternatives_set_updated_at
  before update on public.channel_language_alternatives
  for each row execute function public.set_updated_at();

create index matches_kickoff_time_idx on public.matches(kickoff_time);
create index matches_channel_idx on public.matches(channel);
create index matches_active_idx on public.matches(active);
create index channel_language_alternatives_base_channel_name_idx
  on public.channel_language_alternatives(base_channel_name);
create index match_resource_assignments_date_score_idx
  on public.match_resource_assignments(assignment_date, priority_score desc);

alter table public.channels enable row level security;
alter table public.matches enable row level security;
alter table public.channel_language_alternatives enable row level security;
alter table public.stream_access_audit enable row level security;
alter table public.match_resource_assignments enable row level security;
alter table public.live_matches enable row level security;
revoke all on public.channels, public.matches, public.channel_language_alternatives,
  public.stream_access_audit, public.match_resource_assignments, public.live_matches
  from public, anon, authenticated;
grant select, insert, update, delete on public.channels, public.matches,
  public.channel_language_alternatives, public.stream_access_audit,
  public.match_resource_assignments, public.live_matches to service_role;
revoke all on sequence public.channel_language_alternatives_id_seq,
  public.stream_access_audit_id_seq from public, anon, authenticated;
grant usage, select on sequence public.channel_language_alternatives_id_seq,
  public.stream_access_audit_id_seq to service_role;

-- Preserve the existing public streaming flag; provider URLs remain private.
grant select (id, channel_id, is_streaming_active) on public.live_matches to anon, authenticated;
create policy streaming_flag_read on public.live_matches
  for select to anon, authenticated using (true);
notify pgrst, 'reload schema';
commit;
