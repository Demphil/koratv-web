-- Private source registry: browsers must never be granted SELECT on this table.
begin;
create table if not exists public.stream_sources (
  channel_id text primary key,
  stream_url text not null check (stream_url like 'https://%'),
  allowed_origins text[] not null default '{}'
);
alter table public.stream_sources enable row level security;
revoke all on public.stream_sources from public, anon, authenticated;
grant select, insert, update, delete on public.stream_sources to service_role;
grant select, insert, update, delete on public.live_matches to service_role;
commit;

insert into public.live_matches (id, channel_id, is_streaming_active)
values ('match-01', 'ch1', true)
on conflict (id) do update
set channel_id = excluded.channel_id,
    is_streaming_active = excluded.is_streaming_active;

-- Populate stream_sources with seed-live-match.js using TEST_STREAM_URL.
-- The Worker needs SUPABASE_SECRET_KEY (or a legacy service_role JWT) as a secret.
