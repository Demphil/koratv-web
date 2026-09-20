-- Apply in the Supabase SQL editor. No streams or credentials belong in this table.
begin;
create table if not exists public.live_matches (
  id text primary key,
  channel_id text not null,
  is_streaming_active boolean not null default false
);
alter table public.live_matches enable row level security;
revoke all on public.live_matches from anon, authenticated;
grant select (id, channel_id, is_streaming_active) on public.live_matches to anon, authenticated;
drop policy if exists streaming_flag_read on public.live_matches;
create policy streaming_flag_read on public.live_matches for select to anon, authenticated using (true);
commit;

-- Legacy compatibility only. The current gateway resolves live sources from
-- public.matches.channel -> public.channels.name -> public.channels.original_url.
