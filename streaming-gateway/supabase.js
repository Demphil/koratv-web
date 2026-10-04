import { createClient } from '@supabase/supabase-js';
import { findChannelNameMatch, createChannelNameMatcher } from '../shared/channel-name-match.mjs';
import { broadcastChannelCandidates, deduplicateSourceEvents, normalizeBroadcastChannel } from '../shared/match-broadcasts.mjs';
import { basePriority } from './priority.js';
import { matchPlaybackState } from '../shared/match-lifecycle.mjs';

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

function canonicalizeXtreamHlsUrl(sourceUrl) {
  const raw = String(sourceUrl || '').trim();
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0].toLowerCase() === 'live') return raw;

    const streamId = parts[2].replace(/\.(?:ts|m3u8)$/i, '');
    if (!streamId) return raw;

    url.pathname = `/live/${parts[0]}/${parts[1]}/${streamId}.m3u8`;
    url.search = '';
    return url.href;
  } catch {
    return raw;
  }
}

async function isPlayableHlsSource(sourceUrl) {
  const url = canonicalizeXtreamHlsUrl(sourceUrl);
  if (!url) return false;
  const cached = sourceHealthCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.ok;

  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
          'User-Agent': process.env.IPTV_UPSTREAM_USER_AGENT || 'koratvProviderSync/1.0'
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

export function createMatchesReader(env, sourceFilter = null, catalog = null) {
  const client = createServerClient(env);
  return async () => {
    let matchesQuery = client
      .from(env.SUPABASE_MATCHES_TABLE || 'matches')
      .select('id,match_id,home_team,away_team,league,kickoff_time,channel,source,payload,active,updated_at')
      .eq('active', true)
      .gte('kickoff_time', new Date(Date.now() - 36 * 60 * 60_000).toISOString())
      .lte('kickoff_time', new Date(Date.now() + 72 * 60 * 60_000).toISOString())
      .order('kickoff_time', { ascending: true, nullsFirst: false })
      .limit(500);
    if (Array.isArray(sourceFilter) && sourceFilter.length) matchesQuery = matchesQuery.in('source', sourceFilter);
    else if (sourceFilter) matchesQuery = matchesQuery.eq('source', sourceFilter);

    const [{ data, error }, channelsResult] = await Promise.all([
      matchesQuery,
      client
        .from('channels')
        .select('name,original_url,active')
        .eq('active', true)
    ]);
    if (error) throw new Error(`Match storage unavailable (${error.code || 'network'})`);
    if (channelsResult.error) throw new Error(`Channel storage unavailable (${channelsResult.error.code || 'network'})`);
    const availableChannels = (channelsResult.data || []).filter((channel) => channel?.name && channel?.original_url);
    const catalogSourceCache = new Map();
    const hasCatalogSources = (name, providerIds = []) => {
      if (!catalog) return true;
      const key = String(name || '').trim();
      if (!key) return false;
      const scopedKey = `${key}|${(providerIds || []).join(',')}`;
      if (!catalogSourceCache.has(scopedKey)) {
        catalogSourceCache.set(scopedKey, Object.keys(filterProviderSources(catalog.sources(key), providerIds)).length > 0);
      }
      return catalogSourceCache.get(scopedKey);
    };
    const channelNames = availableChannels.map((channel) => channel.name);
    const matchChannelName = createChannelNameMatcher(channelNames);
    const channelsByName = new Map(availableChannels.map((channel) => [channel.name, channel]));
    const channelMatches = new Map();
    const resolveChannel = (name) => {
      if (channelMatches.has(name)) return channelMatches.get(name);
      const matchedName = matchChannelName(name);
      const result = channelsByName.get(matchedName) || null;
      channelMatches.set(name, result);
      return result;
    };
    const channelCandidatesForRow = (row) => {
      const broadcastCandidates = broadcastChannelCandidates(row);
      if (broadcastCandidates.length) return broadcastCandidates;
      const direct = normalizeBroadcastChannel(row.channel || row.payload?.channel);
      return direct ? [direct] : [];
    };
    const resolvedRows = deduplicateSourceEvents(data || []).map((row) => {
      const matchKey = row.match_id || row.id;
      const routeState = catalog?.matchRoute?.(matchKey);
      const assignment = catalog?.matchAssignment?.(matchKey);
      const override = catalog?.override(matchKey);
      const rowCandidates = override ? [override] : channelCandidatesForRow(row);
      const assignmentIsCurrent = resolvedChannelIsCurrentOrFallback(assignment?.resolvedChannel, rowCandidates, catalog);
      const routeStateIsCurrent = resolvedChannelIsCurrentOrFallback(routeState?.resolvedChannel, rowCandidates, catalog);
      const assignedProviderIds = assignment?.status === 'ASSIGNED' && assignmentIsCurrent && assignment.providerId ? [assignment.providerId] : [];
      const waitingFallbackCandidates = assignment?.status === 'WAITING' && assignmentIsCurrent
        ? removeResolvedChannelCandidate(assignment.resolvedChannel, rowCandidates, catalog)
        : null;
      const candidates = catalog?.override(row.match_id || row.id)
        ? [catalog.override(row.match_id || row.id)]
        : assignment?.status === 'WAITING' && assignmentIsCurrent
          ? waitingFallbackCandidates
        : assignment?.resolvedChannel && assignmentIsCurrent
          ? [assignment.resolvedChannel]
        : routeState?.resolvedChannel && routeStateIsCurrent
          ? [routeState.resolvedChannel]
          : rowCandidates;
      const channel = candidates.map((name) => {
        const canonicalName = catalog?.resolve?.(name);
        if (canonicalName && hasCatalogSources(canonicalName, assignedProviderIds)) return { name: canonicalName };
        const resolved = resolveChannel(name);
        if (resolved && hasCatalogSources(resolved.name, assignedProviderIds)) return resolved;
        const catalogName = catalog?.resolve?.(name) || name;
        return catalog && hasCatalogSources(catalogName, assignedProviderIds) ? { name: catalogName } : null;
      }).find(Boolean);
      return { row, channel, assignment: assignmentIsCurrent ? assignment : null };
    });
    const usedChannelNames = [...new Set(resolvedRows
      .map(({ channel }) => channel?.name)
      .filter(Boolean))];
    const healthChecks = !catalog && env.CHECK_MATCH_SOURCE_HEALTH === 'true'
      ? await mapWithConcurrency(usedChannelNames, Number(env.CHECK_SOURCE_HEALTH_CONCURRENCY || 2), async (name) => [name, await isPlayableHlsSource(availableChannels.find((channel) => channel.name === name)?.original_url)])
      : usedChannelNames.map((name) => [name, true]);
    const readyChannels = new Set(healthChecks
        .filter(([, ok]) => ok)
        .map(([name]) => name)
        .filter((name) => hasCatalogSources(name)));
    return resolvedRows.map(({ row, channel, assignment }) => ({
      ...row,
      channel: channel?.name || row.channel,
      source_ready: Boolean(channel && readyChannels.has(channel.name)),
      resource_status: assignment?.status || null,
      broadcast_rank: assignment?.status === 'ASSIGNED' ? assignment.broadcastRank || null : null,
      manually_selected: assignment?.status === 'ASSIGNED' && assignment.manual === true
    }));
  };
}

async function findMatch(client, table, matchId, sourceFilter = null) {
  const columns = 'id,match_id,kickoff_time,channel,source,payload,active';
  const applySourceFilter = (query) => {
    if (Array.isArray(sourceFilter) && sourceFilter.length) return query.in('source', sourceFilter);
    if (sourceFilter) return query.eq('source', sourceFilter);
    return query;
  };
  const byMatchId = await applySourceFilter(client.from(table).select(columns).eq('match_id', matchId)).maybeSingle();
  if (byMatchId.error) throw new Error(`Match lookup unavailable (${byMatchId.error.code || 'network'})`);
  if (byMatchId.data) return byMatchId.data;
  const byId = await applySourceFilter(client.from(table).select(columns).eq('id', matchId)).maybeSingle();
  if (byId.error) throw new Error(`Match lookup unavailable (${byId.error.code || 'network'})`);
  return byId.data;
}

async function findChannel(client, channelName) {
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
    const channels = allWithQualities.data || [];
    const matchedName = findChannelNameMatch(channelName, channels.map((channel) => channel.name));
    return channels.find((channel) => channel.name === matchedName) || null;
  }
  const allWithoutQualities = await client.from('channels')
    .select('id,name,original_url,active')
    .eq('active', true)
    .limit(1000);
  if (allWithoutQualities.error) throw new Error(`Channel lookup unavailable (${allWithoutQualities.error.code || 'network'})`);
  const channels = allWithoutQualities.data || [];
  const matchedName = findChannelNameMatch(channelName, channels.map((channel) => channel.name));
  const channel = channels.find((item) => item.name === matchedName);
  return channel ? { ...channel, quality_variants: [] } : null;
}

function normalizeQualityVariants(channel) {
  const seen = new Set();
  return (Array.isArray(channel?.quality_variants) ? channel.quality_variants : [])
    .map((variant) => ({
      label: String(variant?.label || '').trim(),
      height: Number(variant?.height || 0),
      url: canonicalizeXtreamHlsUrl(variant?.url)
    }))
    .filter((variant) => variant.label && variant.url && !seen.has(variant.label) && seen.add(variant.label))
    .sort((a, b) => b.height - a.height);
}

function filterProviderSources(sources = {}, providerIds = []) {
  const allowed = new Set((providerIds || []).map((id) => String(id)).filter(Boolean));
  if (!allowed.size) return sources || {};
  return Object.fromEntries(Object.entries(sources || {}).filter(([id]) => allowed.has(String(id))));
}

function resolvedChannelMatchesCandidates(resolvedChannel, candidates = [], catalog = null) {
  const expected = normalizeBroadcastChannel(resolvedChannel);
  if (!expected) return false;
  const expectedCatalogName = catalog?.resolve?.(expected) || expected;
  return (candidates || []).some((candidate) => {
    const normalized = normalizeBroadcastChannel(candidate);
    if (!normalized) return false;
    const catalogName = catalog?.resolve?.(normalized) || normalized;
    return normalized === expected || catalogName === expectedCatalogName;
  });
}

function resolvedChannelIsCurrentOrFallback(resolvedChannel, candidates = [], catalog = null) {
  if (!normalizeBroadcastChannel(resolvedChannel)) return false;
  if (!candidates.length) return true;
  return resolvedChannelMatchesCandidates(resolvedChannel, candidates, catalog);
}

function removeResolvedChannelCandidate(resolvedChannel, candidates = [], catalog = null) {
  const expected = normalizeBroadcastChannel(resolvedChannel);
  if (!expected) return candidates;
  const expectedCatalogName = catalog?.resolve?.(expected) || expected;
  return (candidates || []).filter((candidate) => {
    const normalized = normalizeBroadcastChannel(candidate);
    if (!normalized) return false;
    const catalogName = catalog?.resolve?.(normalized) || normalized;
    return normalized !== expected && catalogName !== expectedCatalogName;
  });
}

export function createPlaybackResolver(env, sourceFilter = null, catalog = null, liveResolver = null) {
  const client = createServerClient(env);
  const table = env.SUPABASE_MATCHES_TABLE || 'matches';
  const opensBeforeMinutes = Number(env.STREAM_OPENS_BEFORE_MINUTES || 20);
  const unavailable = (reason, diagnostics = null) => ({
    is_streaming_active: false,
    reason,
    ...(diagnostics ? { diagnostics } : {})
  });

  return async (matchId, { fresh = false } = {}) => {
    if (typeof matchId !== 'string' || !matchId.trim() || matchId.length > 160) {
      return { is_streaming_active: false, reason: 'invalid_match' };
    }

    const match = await findMatch(client, table, matchId.trim(), sourceFilter);
    if (!match || match.active !== true) return { is_streaming_active: false, reason: 'match_unavailable' };

    const payload = match.payload || {};
    const kickoff = new Date(match.kickoff_time || payload.scheduledAt || '');
    if (Number.isNaN(kickoff.getTime())) return { is_streaming_active: false, reason: 'invalid_kickoff' };

    const playbackState = matchPlaybackState(match, { opensBeforeMinutes });
    if (playbackState !== 'live') return { is_streaming_active: false, reason: playbackState };

    const matchKey = match.match_id || match.id;
    const override = catalog?.override(matchKey);
    const routeState = catalog?.matchRoute?.(matchKey);
    const assignment = catalog?.matchAssignment?.(matchKey);
    const broadcastCandidates = broadcastChannelCandidates(match);
    const fallbackChannel = normalizeBroadcastChannel(match.channel || payload.channel);
    const currentCandidates = override ? [override] : broadcastCandidates.length
      ? broadcastCandidates
      : fallbackChannel
        ? [fallbackChannel]
        : [];
    const assignmentIsCurrent = resolvedChannelIsCurrentOrFallback(assignment?.resolvedChannel, currentCandidates, catalog);
    const routeStateIsCurrent = resolvedChannelIsCurrentOrFallback(routeState?.resolvedChannel, currentCandidates, catalog);
    const waitingFallbackCandidates = assignment?.status === 'WAITING' && assignmentIsCurrent
      ? removeResolvedChannelCandidate(assignment.resolvedChannel, currentCandidates, catalog)
      : null;
    if (assignment?.status === 'WAITING' && assignmentIsCurrent && !waitingFallbackCandidates.length) {
      return unavailable('source_unavailable', {
        stage: 'resource_assignment',
        status: assignment.status,
        resolvedChannel: assignment.resolvedChannel || null,
      });
    }
    const assignedProviderIds = assignment?.status === 'ASSIGNED' && assignmentIsCurrent && assignment.providerId
      ? (catalog.playbackProviderIds?.(matchKey) || [assignment.providerId])
      : [];
    const candidates = override
      ? [override]
      : assignment?.status === 'WAITING' && assignmentIsCurrent
        ? waitingFallbackCandidates
      : assignment?.resolvedChannel && assignmentIsCurrent
        ? [assignment.resolvedChannel]
      : routeState?.resolvedChannel && routeStateIsCurrent
        ? [routeState.resolvedChannel]
        : currentCandidates;
    if (!candidates.length) return unavailable('channel_unavailable', catalog ? {
      stage: 'kooora_broadcast',
      broadcastState: payload.broadcast?.state || null,
      requestedChannels: []
    } : null);
    let channel;
    const attempts = [];
    let liveSources = null;
    // Scheduled discovery owns source renewal; normal viewers use its prepared snapshot.
    if (catalog) {
      for (const name of candidates) {
        const catalogName = catalog.resolve?.(name) || name;
        const sources = filterProviderSources(catalog.sources(catalogName), assignedProviderIds);
        if (Object.keys(sources).length) {
          channel = { name: catalogName, original_url: '', quality_variants: [] };
          liveSources = { resolvedChannel: catalogName, provider_sources: sources };
          break;
        }
      }
    }
    if (catalog && liveResolver?.resolve && (fresh || !liveSources)) {
      const discoveryProviderIds = assignment?.status === 'ASSIGNED' && assignmentIsCurrent
        ? [assignment.providerId] : assignedProviderIds;
      const discovered = await liveResolver.resolve(candidates, { providerIds: discoveryProviderIds, fresh });
      const filteredLiveSources = filterProviderSources(discovered?.provider_sources, assignedProviderIds);
      if (Object.keys(filteredLiveSources).length) {
        const preparedSources = liveSources?.resolvedChannel === discovered.resolvedChannel ? liveSources.provider_sources : {};
        liveSources = { ...discovered, provider_sources: { ...preparedSources, ...filteredLiveSources } };
        channel = { name: liveSources.resolvedChannel || candidates[0], original_url: '', quality_variants: [] };
      }
    }
    for (const name of candidates) {
      if (liveSources?.provider_sources && Object.keys(liveSources.provider_sources).length) break;
      channel = await findChannel(client, name);
      const catalogName = catalog?.resolve?.(channel?.name || name) || channel?.name || name;
      const providerSources = catalog ? filterProviderSources(catalog.sources(catalogName), assignedProviderIds) : {};
      if (catalog) attempts.push({
        requestedName: name,
        channelTableName: channel?.name || null,
        catalogName,
        providerCount: Object.keys(providerSources).length
      });
      if (!channel?.original_url && catalog && Object.keys(providerSources).length) channel = { name: catalogName, original_url: '', quality_variants: [] };
      if (catalog && Object.keys(catalog.sources(channel?.name)).length) break;
      if (!catalog && channel?.original_url) break;
    }
    const resolvedProviderSources = liveSources?.provider_sources && Object.keys(liveSources.provider_sources).length
      ? liveSources.provider_sources
      : filterProviderSources(catalog?.sources(channel?.name), assignedProviderIds);
    if (catalog && !Object.keys(resolvedProviderSources || {}).length) return unavailable('source_unavailable', {
      stage: liveResolver ? 'live_provider_resolution' : 'provider_catalog',
      requestedChannels: candidates,
      assignedProviderIds,
      attempts,
      liveAttempts: liveSources?.attempts || []
    });
    if (!catalog && !channel?.original_url) return { is_streaming_active: false, reason: 'source_unavailable' };
    const primaryUrl = canonicalizeXtreamHlsUrl(channel.original_url);
    const providerSources = resolvedProviderSources;
    const streamUrl = catalog ? Object.values(providerSources)[0] : primaryUrl;
    if (!catalog && env.CHECK_PLAYBACK_SOURCE_HEALTH === 'true' && !(await isPlayableHlsSource(streamUrl))) {
      return { is_streaming_active: false, reason: 'source_unavailable' };
    }
    const qualityVariants = normalizeQualityVariants(channel);

    return {
      is_streaming_active: true,
      match_id: match.match_id || match.id,
      channel_id: channel.name,
      stream_url: streamUrl,
      qualities: catalog ? [] : qualityVariants.map(({ label, height }) => ({ label, height })),
      quality_sources: catalog ? [] : qualityVariants,
      ...(catalog ? { provider_sources: providerSources,
        preferred_provider: assignment?.status === 'ASSIGNED' ? assignment.providerId : null,
        pool_key: `${String(match.kickoff_time).slice(0, 10)}:${payload.broadcast?.sourceMatchId || payload.sourceMatchId || match.match_id}:${channel.name}`,
        priority_score: basePriority(match, channel.name), single_quality: true } : {}),
    };
  };
}
