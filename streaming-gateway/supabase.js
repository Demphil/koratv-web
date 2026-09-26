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

const sourceHealthCache = new Map();

async function isPlayableHlsSource(sourceUrl) {
  const url = String(sourceUrl || '').trim();
  if (!url) return false;
  const cached = sourceHealthCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.ok;

  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
          'User-Agent': process.env.IPTV_UPSTREAM_USER_AGENT || 'VLC/3.0.20 LibVLC/3.0.20'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000)
      });
      if (response.ok) {
        const text = await response.text();
        ok = text.trimStart().startsWith('#EXTM3U');
      } else {
        await response.body?.cancel();
      }
    } catch {
      ok = false;
    }
    if (!ok && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  sourceHealthCache.set(url, { ok, expiresAt: Date.now() + 60_000 });
  return ok;
}

async function mapWithConcurrency(items, limit, worker) {
  const output = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
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
    const channelsByName = new Map((channelsResult.data || [])
      .filter((channel) => channel?.original_url)
      .map((channel) => [normalizeName(channel.name), channel.original_url]));
    const usedChannelNames = [...new Set((data || [])
      .map((row) => normalizeName(row.channel || row.payload?.channel || ''))
      .filter((name) => channelsByName.has(name)))];
    const healthChecks = env.CHECK_MATCH_SOURCE_HEALTH === 'true'
      ? await mapWithConcurrency(usedChannelNames, Number(env.CHECK_SOURCE_HEALTH_CONCURRENCY || 2), async (name) => [name, await isPlayableHlsSource(channelsByName.get(name))])
      : usedChannelNames.map((name) => [name, true]);
    const readyChannels = new Set(healthChecks
      .filter(([, ok]) => ok)
      .map(([name]) => name));
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

async function findChannel(client, channelName) {
  const normalizeChannelName = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9\p{L}]+/giu, '')
    .toLowerCase();
  const selectColumns = 'id,name,original_url,quality_variants,active';
  const withQualities = await client.from('channels')
    .select(selectColumns)
    .eq('name', channelName)
    .eq('active', true)
    .limit(1);
  if (!withQualities.error && withQualities.data?.[0]) return withQualities.data[0];
  if (withQualities.error && !/quality_variants|column .* does not exist|schema cache/i.test(withQualities.error.message || '')) {
    throw new Error(`Channel lookup unavailable (${withQualities.error.code || 'network'})`);
  }
  const withoutQualities = await client.from('channels')
    .select('id,name,original_url,active')
    .eq('name', channelName)
    .eq('active', true)
    .limit(1);
  if (withoutQualities.error) throw new Error(`Channel lookup unavailable (${withoutQualities.error.code || 'network'})`);
  if (withoutQualities.data?.[0]) return { ...withoutQualities.data[0], quality_variants: [] };

  const allWithQualities = await client.from('channels')
    .select(selectColumns)
    .eq('active', true)
    .limit(1000);
  if (!allWithQualities.error) {
    const wanted = normalizeChannelName(channelName);
    return (allWithQualities.data || []).find((channel) => normalizeChannelName(channel.name) === wanted) || null;
  }
  const allWithoutQualities = await client.from('channels')
    .select('id,name,original_url,active')
    .eq('active', true)
    .limit(1000);
  if (allWithoutQualities.error) throw new Error(`Channel lookup unavailable (${allWithoutQualities.error.code || 'network'})`);
  const wanted = normalizeChannelName(channelName);
  const channel = (allWithoutQualities.data || []).find((item) => normalizeChannelName(item.name) === wanted);
  return channel ? { ...channel, quality_variants: [] } : null;
}

function normalizeQualityVariants(channel) {
  const seen = new Set();
  return (Array.isArray(channel?.quality_variants) ? channel.quality_variants : [])
    .map((variant) => ({
      label: String(variant?.label || '').trim(),
      height: Number(variant?.height || 0),
      url: String(variant?.url || '').trim()
    }))
    .filter((variant) => variant.label && variant.url && !seen.has(variant.label) && seen.add(variant.label))
    .sort((a, b) => b.height - a.height);
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

    const channelName = String(match.channel || payload.channel || env.DEFAULT_LIVE_CHANNEL || 'beIN SPORTS HD 1').trim();
    if (!channelName) return { is_streaming_active: false, reason: 'channel_unavailable' };

    const channel = await findChannel(client, channelName) || await findChannel(client, env.DEFAULT_LIVE_CHANNEL || 'beIN SPORTS HD 1');
    if (!channel?.original_url) return { is_streaming_active: false, reason: 'source_unavailable' };
    if (env.CHECK_PLAYBACK_SOURCE_HEALTH === 'true' && !(await isPlayableHlsSource(channel.original_url))) {
      return { is_streaming_active: false, reason: 'source_unavailable' };
    }
    const qualityVariants = normalizeQualityVariants(channel);

    return {
      is_streaming_active: true,
      match_id: match.match_id || match.id,
      channel_id: channel.name,
      stream_url: channel.original_url,
      qualities: qualityVariants.map(({ label, height }) => ({ label, height })),
      quality_sources: qualityVariants,
    };
  };
}
