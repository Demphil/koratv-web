-- Safe daily match route state. This table stores names and state only.
-- It must never store raw IPTV/provider playback URLs.
begin;
create table if not exists public.match_route_state (
  match_id text primary key,
  route_date date not null,
  requested_channels text[] not null default '{}',
  requested_channel text,
  resolved_channel text,
  matched_alias text,
  provider_ids text[] not null default '{}',
  status text not null check (status in ('RESOLVED', 'UNRESOLVED')),
  updated_at timestamptz not null default now()
);
alter table public.match_route_state enable row level security;
revoke all on public.match_route_state from public, anon, authenticated;
grant select, insert, update, delete on public.match_route_state to service_role;
commit;
