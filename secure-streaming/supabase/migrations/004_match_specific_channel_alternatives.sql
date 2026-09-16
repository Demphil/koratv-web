alter table public.channel_language_alternatives
  drop constraint if exists channel_language_alternatives_base_channel_name_language_key;

alter table public.channel_language_alternatives
  add constraint channel_language_alternatives_match_id_language_key unique (match_id, language);

create index if not exists channel_language_alternatives_base_channel_name_idx
  on public.channel_language_alternatives (base_channel_name);
