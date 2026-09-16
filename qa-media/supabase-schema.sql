create table if not exists public.media_qa_staging (
  match_id text primary key,
  payload jsonb not null,
  environment text not null default 'staging' check (environment = 'staging'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.media_qa_staging enable row level security;

revoke all on public.media_qa_staging from anon, authenticated;

grant select on public.media_qa_staging to anon, authenticated;
drop policy if exists "Public can read validated staging streams" on public.media_qa_staging;
drop policy if exists "Public can read staged match metadata" on public.media_qa_staging;
create policy "Public can read staged match metadata"
  on public.media_qa_staging
  for select
  to anon, authenticated
  using (environment = 'staging' and payload->>'status' = 'METADATA_READY');
