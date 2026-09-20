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

export function createMatchesReader(env) {
  const client = createServerClient(env);
  const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('en');
  return async () => {
    const [{ data, error }, channelsResult] = await Promise.all([
      client
      .from(env.SUPABASE_MATCHES_TABLE || 'matches')
      .select('id,match_id,home_team,away_team,league,kickoff_time,channel,payload,active,updated_at')
      .eq('active', true)
      .order('kickoff_time', { ascending: true, nullsFirst: false })
        .limit(500),
      client
        .from('channels')
        .select('name,original_url,active')
        .eq('active', true)
    ]);
    if (error) throw new Error(`Match storage unavailable (${error.code || 'network'})`);
    if (channelsResult.error) throw new Error(`Channel storage unavailable (${channelsResult.error.code || 'network'})`);
    const readyChannels = new Set((channelsResult.data || [])
      .filter((channel) => channel?.original_url)
      .map((channel) => normalizeName(channel.name)));
    return Array.isArray(data)
      ? data.map((row) => {
          const payload = row.payload || {};
          const channelName = row.channel || payload.channel || '';
          return { ...row, source_ready: readyChannels.has(normalizeName(channelName)) };
        })
      : [];
  };
}

function isEndedStatus(payload = {}) {
  const value = String(payload.status || payload.state || payload.matchStatus || '').toLowerCase();
  return /result|finished|ended|full.?time|انته/.test(value);
}

async function findMatch(client, table, matchId) {
  const columns = 'id,match_id,kickoff_time,channel,payload,active';
  const byMatchId = await client.from(table).select(columns).eq('match_id', matchId).maybeSingle();
  if (byMatchId.error) throw new Error(`Match lookup unavailable (${byMatchId.error.code || 'network'})`);
  if (byMatchId.data) return byMatchId.data;
  const byId = await client.from(table).select(columns).eq('id', matchId).maybeSingle();
  if (byId.error) throw new Error(`Match lookup unavailable (${byId.error.code || 'network'})`);
  return byId.data;
}

export function createPlaybackResolver(env) {
  const client = createServerClient(env);
  const table = env.SUPABASE_MATCHES_TABLE || 'matches';
  const opensBeforeMs = Number(env.STREAM_OPENS_BEFORE_MINUTES || 20) * 60_000;
  const closesAfterMs = Number(env.STREAM_CLOSES_AFTER_MINUTES || 150) * 60_000;

  return async (matchId) => {
    if (typeof matchId !== 'string' || !matchId.trim() || matchId.length > 160) {
      return { is_streaming_active: false, reason: 'invalid_match' };
    }

    const match = await findMatch(client, table, matchId.trim());
    if (!match || match.active !== true) return { is_streaming_active: false, reason: 'match_unavailable' };

    const payload = match.payload || {};
    const kickoff = new Date(match.kickoff_time || payload.scheduledAt || '');
    if (Number.isNaN(kickoff.getTime())) return { is_streaming_active: false, reason: 'invalid_kickoff' };

    const now = Date.now();
    if (isEndedStatus(payload) || now > kickoff.getTime() + closesAfterMs) {
      return { is_streaming_active: false, reason: 'ended' };
    }
    if (now < kickoff.getTime() - opensBeforeMs) {
      return { is_streaming_active: false, reason: 'upcoming' };
    }

    const channelName = String(match.channel || payload.channel || '').trim();
    if (!channelName) return { is_streaming_active: false, reason: 'channel_unavailable' };

    const { data: channel, error } = await client.from('channels')
      .select('id,name,original_url,active')
      .eq('name', channelName)
      .eq('active', true)
      .maybeSingle();
    if (error) throw new Error(`Channel lookup unavailable (${error.code || 'network'})`);
    if (!channel?.original_url) return { is_streaming_active: false, reason: 'source_unavailable' };

    return {
      is_streaming_active: true,
      match_id: match.match_id || match.id,
      channel_id: channel.name,
      stream_url: channel.original_url,
    };
  };
}
