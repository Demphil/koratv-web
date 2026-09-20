import { createClient } from '@supabase/supabase-js';

function createServerClient(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Configure Supabase URL and key');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(4000) }) },
  });
}

export function createStreamingConfigReader(env) {
  const client = createServerClient(env);
  return async (matchId, channel) => {
    if (typeof matchId !== 'string' || !matchId || matchId.length > 128) return { is_streaming_active: false };
    const { data, error } = await client.from('live_matches')
      .select('is_streaming_active,channel_id').eq('id', matchId).maybeSingle();
    if (error) throw new Error(`Streaming configuration unavailable (${error.code || 'network'})`);
    return { is_streaming_active: data?.is_streaming_active === true && (!channel || data.channel_id === channel) };
  };
}

export function createMatchesReader(env) {
  const client = createServerClient(env);
  return async () => {
    const { data, error } = await client
      .from(env.SUPABASE_MATCHES_TABLE || 'matches')
      .select('id,match_id,home_team,away_team,league,kickoff_time,channel,payload,active,updated_at')
      .eq('active', true)
      .order('kickoff_time', { ascending: true, nullsFirst: false })
      .limit(150);
    if (error) throw new Error(`Match storage unavailable (${error.code || 'network'})`);
    return Array.isArray(data) ? data : [];
  };
}
