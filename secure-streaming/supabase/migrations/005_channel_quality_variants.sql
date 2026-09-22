alter table public.channels
add column if not exists quality_variants jsonb not null default '[]'::jsonb;

comment on column public.channels.quality_variants is
'Sanitized server-side list of available HLS quality variants for the channel. URLs remain server-only and are never returned to public match feeds.';

notify pgrst, 'reload schema';
