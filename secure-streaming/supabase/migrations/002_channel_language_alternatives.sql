create table if not exists public.channel_language_alternatives (
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
  unique (base_channel_name, language)
);

alter table public.channel_language_alternatives enable row level security;
revoke all on public.channel_language_alternatives from anon, authenticated;

drop trigger if exists channel_language_alternatives_set_updated_at on public.channel_language_alternatives;
create trigger channel_language_alternatives_set_updated_at
before update on public.channel_language_alternatives
for each row execute function public.set_updated_at();
