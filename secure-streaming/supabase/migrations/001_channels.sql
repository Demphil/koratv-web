create extension if not exists pgcrypto;

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  original_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stream_access_audit (
  id bigserial primary key,
  channel_id uuid references public.channels(id) on delete set null,
  channel_name text not null,
  ip_hash text,
  user_agent text,
  event text not null,
  created_at timestamptz not null default now()
);

alter table public.channels enable row level security;
alter table public.stream_access_audit enable row level security;

revoke all on public.channels from anon, authenticated;
revoke all on public.stream_access_audit from anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists channels_set_updated_at on public.channels;
create trigger channels_set_updated_at
before update on public.channels
for each row execute function public.set_updated_at();
