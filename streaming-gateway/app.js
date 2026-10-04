import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomUUID, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClientIpResolver } from './client-ip.js';
import { antiBotMiddleware } from './anti-bot.js';
import { HlsResourceCache } from './hls-resource-cache.js';
import { ProviderPool, PoolError, PROVIDER_IDS } from './provider-pool.js';
import { AccountHealth } from './account-health.js';
import { HlsProgressMonitor } from './hls-progress.js';
import { singleQualityManifest } from './single-quality.js';
import { diagnosticPlayback, registerMultiview } from './multiview.js';
import { isAllowedMatch, normalizeTeamName } from '../shared/league-whitelist.mjs';
import { matchPlaybackState as providerPlaybackState, sourceMatchState } from '../shared/match-lifecycle.mjs';
import { resolvePublicMatchId } from '../shared/public-match-id.mjs';
import { registerOperatorConsole, installPreparedOperatorChannel, refreshOperatorResources } from './operator-console.js';

const issuer = 'koratv-gateway';
const entryTtl = 300;
const playerSources = "script-src 'self' 'unsafe-inline' https://nap5k.com https://n6wxm.com https://al5sm.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' blob: https://stream-api.koratv.click; connect-src 'self' https:; worker-src blob:; frame-src 'self' https:";

function originFromHeader(value) {
  if (!value) return '';
  try {
    return new URL(String(value)).origin;
  } catch {
    return '';
  }
}

function canServePlayerDocument(req, allowedOrigins) {
  return true;
}

function moroccoPart(value, options) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', ...options }).format(date);
}

function matchPlaybackState(row, config) {
  return providerPlaybackState(row, {
    opensBeforeMinutes: Number(process.env.STREAM_OPENS_BEFORE_MINUTES || config.streamOpensBeforeMinutes || 20)
  });
}

function clampLiveMinute(row) {
  const payload = row.payload || {};
  const explicit = Number(payload.minute ?? payload.liveMinute ?? payload.matchMinute);
  if (Number.isFinite(explicit)) return explicit > 0 ? Math.min(130, Math.round(explicit)) : null;

  return null;
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text || /^null$/i.test(text) || /^undefined$/i.test(text)) return fallback;
  return text;
}

function hlsResourceKind(url) {
  const path = String(url.pathname || '').toLowerCase();
  if (/\.m3u8?$/.test(path)) return 'manifest';
  if (/\.(?:ts|m4s|mp4|cmfv|cmfa|aac)$/.test(path)) return 'segment';
  return '';
}

function cacheTtl(kind) {
  return kind === 'manifest'
    ? Math.max(250, Number(process.env.HLS_MANIFEST_CACHE_TTL_MS || 900))
    : Math.max(1000, Number(process.env.HLS_SEGMENT_CACHE_TTL_MS || 30000));
}

function requestOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  if (!host) return '';
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return '';
  }
}

function resourceApiOrigin(req, config) {
  const configured = config.api;
  const current = requestOrigin(req);
  if (configured === config.player) {
    if (config.resourceApi) return config.resourceApi;
    if (current && current !== config.player) return current;
    return 'https://stream-api.koratv.click';
  }
  return configured;
}

function normalizeScore(value, playbackState = '') {
  const score = cleanText(value);
  if (!score || /^vs$/i.test(score) || /null|undefined/i.test(score)) return 'VS';
  const parts = score.split('-').map((part) => cleanText(part));
  if (parts.length >= 2 && parts[0] !== '' && parts[1] !== '') return `${parts[0]} - ${parts[1]}`;
  return 'VS';
}

function normalizeCardCount(value) {
  if (typeof value === 'number') return { home: Number.isFinite(value) ? value : 0, away: 0 };
  if (!value || typeof value !== 'object') return null;
  const home = Number(value.home ?? value.homeTeam ?? value.local ?? value.teamA ?? value.first ?? value[0] ?? 0);
  const away = Number(value.away ?? value.awayTeam ?? value.visitor ?? value.teamB ?? value.second ?? value[1] ?? 0);
  return {
    home: Number.isFinite(home) ? home : 0,
    away: Number.isFinite(away) ? away : 0
  };
}

function normalizeMatch(row, config) {
  const payload = row.payload || {};
  const scheduledAt = row.kickoff_time || payload.scheduledAt || '';
  const playbackState = matchPlaybackState(row, config);
  const cards = payload.cards || payload.stats?.cards || {};
  const channelName = cleanText(row.channel || payload.channel);
  const sourceAvailable = row.source_ready === true;
  return {
    match_id: row.match_id || row.id,
    matchId: row.match_id || row.id,
    homeTeam: row.home_team || payload.homeTeam?.name || payload.homeTeam || '',
    awayTeam: row.away_team || payload.awayTeam?.name || payload.awayTeam || '',
    homeTeamArabic: cleanText(payload.homeTeamArabic || payload.homeTeam?.nameAr || payload.homeTeam?.arabicName),
    awayTeamArabic: cleanText(payload.awayTeamArabic || payload.awayTeam?.nameAr || payload.awayTeam?.arabicName),
    homeTeamId: payload.homeTeamId || null,
    awayTeamId: payload.awayTeamId || null,
    homeLogo: payload.homeLogo || payload.homeTeam?.logo || '',
    awayLogo: payload.awayLogo || payload.awayTeam?.logo || '',
    scheduledAt,
    time: cleanText(payload.time, moroccoPart(scheduledAt, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })),
    score: normalizeScore(payload.score, playbackState),
    league: row.league || payload.league || '',
    channelName,
    leagueCountry: cleanText(payload.leagueCountry || payload.country || payload.league?.country),
    commentator: payload.commentator || '',
    status: cleanText(payload.status || payload.state || payload.matchStatus),
    streams: [],
    sourceReady: sourceAvailable && playbackState === 'live',
    sourceAvailable,
    resourceStatus: row.resource_status || null,
    broadcastRank: row.broadcast_rank || null,
    manuallySelected: row.manually_selected === true,
    viewingMode: playbackState === 'live' ? (sourceAvailable ? 'stream' : 'live_updates') : playbackState,
    playbackState,
    isLive: playbackState === 'live',
    liveMinute: playbackState === 'live' ? clampLiveMinute(row) : null,
    liveExtraMinute: playbackState === 'live' ? Math.max(0, Number(payload.liveExtraMinute) || 0) : 0,
    yellowCards: normalizeCardCount(payload.yellowCards || cards.yellow || payload.stats?.yellowCards),
    redCards: normalizeCardCount(payload.redCards || cards.red || payload.stats?.redCards),
    goals: Array.isArray(payload.goals) ? payload.goals.slice(0, 12).map((goal) => ({
      player: String(goal.player || goal.name || '').slice(0, 80),
      minute: String(goal.minute || '').slice(0, 12),
      team: String(goal.team || '').slice(0, 16)
    })) : [],
    events: normalizeMatchEvents(payload.events),
    lineups: normalizeLineups(payload.lineups),
    statistics: normalizeMatchStatistics(payload.statistics),
    venue: cleanText(payload.venue).slice(0, 120),
    venueCity: cleanText(payload.venueCity).slice(0, 90),
    referee: cleanText(payload.referee).slice(0, 90),
    standings: payload.standingsVersion === 2 && Array.isArray(payload.standings) ? payload.standings.slice(0, 40) : [],
    knockout: normalizeKnockout(payload.knockout),
    dataSource: payload.dataSource || row.source || '',
    sourceFixtureId: payload.sourceFixtureId || payload.sourceMatchId || '',
    eventDetailsLoaded: payload.eventDetailsLoaded === true,
    detailsState: payload.detailsState || (payload.eventDetailsLoaded ? 'ready' : 'pending'),
    detailStates: Object.fromEntries(['lineups', 'statistics', 'events'].map(feature => [feature,
      ['available', 'stale', 'pending', 'not_covered'].includes(payload.detailStates?.[feature]) ? payload.detailStates[feature] : 'pending'])),
    detailsUpdatedAt: payload.detailsUpdatedAt || null,
    updatedAt: row.updated_at
  };
}

function safePlayerPhoto(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'media.api-sports.io' ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeLineups(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((lineup) => {
    const normalizePlayers = (players, limit) => (Array.isArray(players) ? players : []).slice(0, limit).map((entry) => ({
      id: entry?.id || null,
      name: cleanText(entry?.name).slice(0, 90),
      number: Number(entry?.number) || null,
      position: cleanText(entry?.position).slice(0, 12),
      grid: cleanText(entry?.grid).slice(0, 12),
      rating: entry?.rating != null && Number.isFinite(Number(entry.rating)) && Number(entry.rating) >= 0 && Number(entry.rating) <= 10 ? Number(entry.rating) : null,
      photo: safePlayerPhoto(entry?.photo)
    }));
    return {
      team: cleanText(typeof lineup?.team === 'string' ? lineup.team : lineup?.team?.name).slice(0, 90),
      teamId: lineup?.team?.id || lineup?.teamId || null,
      formation: cleanText(lineup?.formation).slice(0, 16),
      coach: cleanText(typeof lineup?.coach === 'string' ? lineup.coach : lineup?.coach?.name).slice(0, 90),
      coachPhoto: safePlayerPhoto(lineup?.coach?.photo),
      startXI: normalizePlayers(lineup?.startXI, 11),
      substitutes: normalizePlayers(lineup?.substitutes, 15)
    };
  });
}

function normalizeKnockout(value) {
  if (!value || !Array.isArray(value.rounds)) return null;
  return { rounds: value.rounds.slice(0,2).filter(round => ['semifinal','final'].includes(round?.key)).map(round => ({
    key: round.key, name: round.key === 'final' ? 'النهائي' : 'نصف النهائي',
    matches: (Array.isArray(round.matches) ? round.matches : []).slice(0,8).map(item => ({
      fixtureId: cleanText(item.fixtureId).slice(0,40), homeTeam: cleanText(item.homeTeam).slice(0,90),
      awayTeam: cleanText(item.awayTeam).slice(0,90), homeLogo: safePlayerPhoto(item.homeLogo), awayLogo: safePlayerPhoto(item.awayLogo),
      score: cleanText(item.score).slice(0,20), scheduledAt: cleanText(item.scheduledAt).slice(0,40), status: cleanText(item.status).slice(0,16),
    })),
  })) };
}

function normalizeMatchStatistics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((team) => ({
    team: cleanText(team?.team?.name).slice(0, 90),
    statistics: (Array.isArray(team?.statistics) ? team.statistics : []).slice(0, 50).map((item) => ({
      type: cleanText(item?.type).slice(0, 60),
      value: item?.value == null ? null : String(item.value).slice(0, 40)
    }))
  }));
}

function normalizeMatchEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((event) => ({
    elapsed: Number(event?.elapsed) || null,
    extra: Number(event?.extra) || null,
    team: cleanText(event?.team).slice(0, 90),
    player: cleanText(event?.player).slice(0, 90),
    assist: cleanText(event?.assist).slice(0, 90),
    type: cleanText(event?.type).slice(0, 40),
    detail: cleanText(event?.detail).slice(0, 60),
    comments: cleanText(event?.comments).slice(0, 100)
  }));
}

function normalizeMatchName(value) {
  return normalizeTeamName(String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim())
    .toLocaleLowerCase('ar');
}

function matchCompletenessScore(match) {
  let score = 0;
  if (match.resourceStatus === 'ASSIGNED') score += 100;
  if (match.sourceReady) score += 20;
  if (match.sourceAvailable) score += 10;
  if (match.playbackState === 'live') score += 12;
  if (match.playbackState === 'ended') score += 8;
  if (match.league && !/^league$/i.test(String(match.league).trim())) score += 8;
  if (match.homeLogo) score += 4;
  if (match.awayLogo) score += 4;
  if (match.score && match.score !== 'VS') score += 5;
  if (Number.isFinite(Number(match.liveMinute))) score += 3;
  if ((match.yellowCards?.home || match.yellowCards?.away || match.redCards?.home || match.redCards?.away)) score += 3;
  if (Array.isArray(match.goals) && match.goals.length) score += 2;
  return score;
}

function dedupeNormalizedMatches(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const teams = [normalizeMatchName(match.homeTeam), normalizeMatchName(match.awayTeam)].sort().join('|');
    const key = `${teams}|${String(match.scheduledAt || '').slice(0, 10)}`;
    const current = byKey.get(key);
    if (!current || matchCompletenessScore(match) > matchCompletenessScore(current)) byKey.set(key, match);
  }
  return [...byKey.values()];
}

function allowedMatch(match) {
  if (sourceMatchState(match) === 'unavailable') return false;
  return isAllowedMatch({
    league: match.league,
    leagueCountry: match.leagueCountry,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam
  });
}

export function createApp({ config, redis, fetchImpl = fetch }) {
  const app = express();
  const accountHealth = config.providerPoolEnabled && config.providerAccounts ? new AccountHealth({ accounts: config.providerAccounts, path: config.accountsStatusPath, fetchImpl }) : null;
  const providerPool = config.providerPoolEnabled ? new ProviderPool({ health: accountHealth }) : null;
  const hlsProgress = new HlsProgressMonitor();
  accountHealth?.attach(providerPool);
  app.locals.accountHealth = accountHealth;
  app.locals.providerPool = providerPool;
  const hlsCache = new HlsResourceCache({
    maxBytes: Math.max(4, Number(process.env.HLS_CACHE_MAX_MB || 32)) * 1024 * 1024,
    maxEntryBytes: Math.max(1, Number(process.env.HLS_CACHE_MAX_ENTRY_MB || 6)) * 1024 * 1024,
    prefetchConcurrency: Math.max(1, Number(process.env.HLS_PREFETCH_CONCURRENCY || 2)),
    maxPrefetchQueue: Math.max(2, Number(process.env.HLS_PREFETCH_QUEUE_LIMIT || 24))
  });
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustedProxies);
  app.use('/api/operator/image', express.json({ limit: '260kb' }));
  app.use('/api/operator/notices', express.json({ limit: '10kb' }));
  app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    });
    const frontendOrigins = config.frontendOrigins || new Set([config.frontend]);
    const tokenOrigins = new Set([...frontendOrigins, config.player]);
    const allowedOrigins = ['/api/generate-token', '/api/config', '/api/matches', '/api/broadcast-control', '/api/broadcast-events'].includes(req.path) ? tokenOrigins : new Set([config.player]);
    const requestOrigin = req.headers.origin;
    if (allowedOrigins.has(requestOrigin)) {
      res.set({ 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(allowedOrigins.has(requestOrigin) ? 204 : 403);
    next();
  });
  app.use(antiBotMiddleware({ enabled: config.enableAntiBot !== false }));
  const clientIp = createClientIpResolver(config.cloudflareProxies);
  const ipHash = (req) => createHmac('sha256', config.hmacSecret).update(clientIp(req)).digest('hex');
  const sign = (claims, audience, expiresIn = entryTtl) => jwt.sign(claims, config.secret, { algorithm: 'HS256', issuer, audience, expiresIn, jwtid: randomUUID() });
  const verify = (token, req, audience) => {
    const claims = jwt.verify(token, config.secret, { algorithms: ['HS256'], issuer, audience });
    const allowEntryIpMismatch = audience === 'player-entry' && config.relaxEntryIpBinding === true;
    const allowHlsIpMismatch = audience === 'hls-session' && config.relaxHlsIpBinding === true;
    if ((!allowEntryIpMismatch && !allowHlsIpMismatch && claims.ip !== ipHash(req)) || !claims.channel || !claims.matchId) throw new Error('Forbidden');
    return claims;
  };
  const requestToken = (req) => {
    const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
    return req.query.token || bearer || '';
  };
  const resolvePlayback = (claims, options) => claims.diagnostic === true
    ? diagnosticPlayback(config, claims.channel)
    : config.getPlaybackForSource(claims.source, claims.matchId, options);
  registerMultiview(app, { config, redis, providerPool, accountHealth, hlsProgress, ipHash, sign });
  const frontendOrigins = config.frontendOrigins || new Set([config.frontend]);
  const tokenOrigins = new Set([...frontendOrigins, config.player]);
  // Public player documents also support opaque file:// parents. API origin checks stay strict.
  const playerDocumentCsp = `default-src 'none'; ${playerSources}; base-uri 'none'; form-action 'none'`;
  const requireOrigin = (req, expected) => {
    const allowedOrigins = expected instanceof Set ? expected : new Set([expected]);
    const requestOrigin = req.headers.origin
      ? originFromHeader(req.headers.origin)
      : originFromHeader(req.headers.referer);
    if (!allowedOrigins.has(requestOrigin)) throw new Error('Forbidden');
  };
  const rejectUnexpectedOrigin = (req, expected) => {
    const allowedOrigins = expected instanceof Set ? expected : new Set([expected]);
    const requestOrigin = req.headers.origin
      ? originFromHeader(req.headers.origin)
      : originFromHeader(req.headers.referer);
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) throw new Error('Forbidden');
  };
  const key = createHash('sha256').update(config.secret).update('resource-urls').digest();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const upstreamDelay = (attempt) => Math.min(5000, 600 * (2 ** Math.max(0, attempt - 1)));
  const retryableStatus = (status) => status === 408 || status === 429 || status >= 500;
  const failoverStatus = (status) => [401, 403, 404, 408, 429, 500, 502, 503, 504, 509].includes(Number(status));
  const fetchUpstream = async (source, options, attempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const upstream = await fetchImpl(source, {
          ...options,
          signal: AbortSignal.any([AbortSignal.timeout(attempt === 1 ? 10000 : 16000), ...(options.signal ? [options.signal] : [])])
        });
        if (upstream.ok || !retryableStatus(upstream.status) || attempt === attempts) return upstream;
        await upstream.body?.cancel();
        console.warn('[stream-proxy] retrying upstream request', {
          attempt,
          status: upstream.status,
          source: source.origin
        });
      } catch (error) {
        if (options.signal?.aborted) throw new PoolError('pool_reassigned', 409);
        lastError = error;
        if (attempt === attempts) throw error;
        console.warn('[stream-proxy] upstream request failed, retrying', {
          attempt,
          message: error?.message || String(error),
          source: source.origin
        });
      }
      await wait(upstreamDelay(attempt));
    }
    throw lastError || new Error('upstream_fetch_failed');
  };
  const fetchLeasedUpstream = (source, options, lease) => lease ? providerPool.run(lease, async signal => {
    const media = hlsResourceKind(source) === 'segment';
    try {
      // HLS retries media loads; nested server retries block the shared account queue.
      const response = await fetchUpstream(source, { ...options, signal }, 1);
      if (providerPool.valid(lease)) accountHealth?.observe(lease.provider, response.status, media);
      const bytes = await response.arrayBuffer();
      if (media && response.ok) lease.transientFailures = 0;
      else if (media && retryableStatus(response.status)) lease.transientFailures = (lease.transientFailures || 0) + 1;
      const buffered = new Response(bytes, { status: response.status, headers: response.headers });
      Object.defineProperty(buffered, 'url', { value: response.url });
      return buffered;
    } catch (error) {
      if (media && !signal.aborted) lease.transientFailures = (lease.transientFailures || 0) + 1;
      throw error;
    }
  }) : fetchUpstream(source, options);
  const fetchCachedUpstream = (source, options, version = '', lease = null) => {
    const kind = hlsResourceKind(source);
    const cache = kind && !options.headers?.Range && options.method !== 'HEAD';
    if (!cache) return fetchLeasedUpstream(source, options, lease);
    const key = `${lease ? `${lease.id}:` : ''}${kind}:${source.href}${kind === 'segment' && version ? `:${version}` : ''}`;
    return hlsCache.load(key, { ttlMs: cacheTtl(kind) }, () => fetchLeasedUpstream(source, options, lease));
  };

  const prewarmState = {
    enabled: Boolean(providerPool && config.prewarmAssignedResources && config.providerAssignments),
    running: false,
    lastRunAt: null,
    lastReason: null,
    warmed: 0,
    failed: 0,
    results: []
  };
  const prewarmKeepalive = new Map();
  const preparedMatches = new Map();
  const normalizeRuntimeMatch = row => {
    if (!prewarmState.enabled || row.resource_status !== 'ASSIGNED') return normalizeMatch(row, config);
    const prepared = preparedMatches.get(row.match_id || row.id);
    const ready = prepared?.ok && prepared.channel === cleanText(row.channel || row.payload?.channel)
      && providerPool.valid(prepared.lease)
      && Date.now() - prepared.checkedAt < 2 * (config.prewarmIntervalMs || 60_000);
    return normalizeMatch({ ...row, source_ready: Boolean(ready) }, config);
  };
  app.locals.providerPrewarm = prewarmState;
  if (config.primeMatchSnapshots) {
    const primeTimer = setTimeout(() => config.primeMatchSnapshots().catch(() => {}), 100);
    primeTimer.unref();
    app.locals.matchSnapshotStartupTimer = primeTimer;
  }

  const warmPlaybackManifest = async (playback, lease) => {
    const headers = { 'User-Agent': config.upstreamUserAgent, Accept: '*/*' };
    let url = new URL(lease.mediaUrl || lease.url);
    for (let depth = 0; depth < 3; depth += 1) {
      const response = await fetchCachedUpstream(url, { headers, redirect: 'follow' }, '', lease);
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, status: response.status };
      }
      const text = await response.text();
      if (!text.trimStart().startsWith('#EXTM3U')) return { ok: false, error: 'invalid_manifest' };
      const base = response.url || url.href;
      const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
      if (text.includes('#EXT-X-STREAM-INF:') && lines[0]) {
        url = new URL(lines[0], base);
        continue;
      }
      lease.mediaUrl = allowedUrl(base, new Set([new URL(base).origin])).href;
      if (!lines.length) return { ok: false, error: 'empty_manifest' };
      const sequence = Number(text.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m)?.[1]);
      const hasSequence = Number.isSafeInteger(sequence) && sequence >= 0;
      const hash = hasSequence ? '' : createHash('sha256').update(text).digest('hex').slice(0, 16);
      const lastIndex = lines.length - 1;
      const lastTarget = new URL(lines[lastIndex], base);
      const lastVersion = hasSequence ? `msn-${sequence + lastIndex}` : `mf-${hash}-${lastIndex}`;
      const segment = await fetchCachedUpstream(lastTarget, { headers, redirect: 'follow' }, lastVersion, lease);
      if (!segment.ok) {
        await segment.body?.cancel();
        return { ok: false, status: segment.status, error: 'segment_unavailable' };
      }
      if (!(await segment.arrayBuffer()).byteLength) return { ok: false, error: 'empty_segment' };
      for (let index = Math.max(0, lines.length - 4); index < lines.length; index += 1) {
        if (index === lastIndex) continue;
        const target = new URL(lines[index], base);
        const version = hasSequence ? `msn-${sequence + index}` : `mf-${hash}-${index}`;
        hlsCache.schedulePrefetch(
          `${lease.id}:segment:${target.href}:${version}`,
          { ttlMs: cacheTtl('segment') },
          () => fetchLeasedUpstream(target, { headers, redirect: 'follow' }, lease)
        );
      }
      return { ok: true, channel: playback.channel_id, provider: lease.provider };
    }
    return { ok: false, error: 'playlist_depth' };
  };

  const prewarmAssignedResources = async (reason = 'interval', { fresh = false } = {}) => {
    if (!prewarmState.enabled || prewarmState.running) return prewarmState;
    prewarmState.running = true;
    prewarmState.lastRunAt = new Date().toISOString();
    prewarmState.lastReason = reason;
    const results = [];
    const currentKeys = new Set();
    try {
      const assignments = (config.providerAssignments?.().assignments || [])
        .filter((assignment) => assignment?.matchId && assignment?.providerId)
        .slice(0, config.prewarmMaxResources || 8);
      const scheduledViewers = new Set(assignments.map(item => `prewarm:${item.matchId}`));
      for (const id of preparedMatches.keys()) {
        if (!scheduledViewers.has(`prewarm:${id}`)) preparedMatches.delete(id);
      }
      for (const [key, viewerId] of prewarmKeepalive) {
        if (!scheduledViewers.has(viewerId)) {
          providerPool.releaseViewer(key, viewerId);
          prewarmKeepalive.delete(key);
        }
      }
      for (const assignment of assignments) {
        const result = {
          matchId: assignment.matchId,
          channel: assignment.resolvedChannel || null,
          provider: assignment.providerId || null
        };
        try {
          let playback = await config.getPlaybackForSource('', assignment.matchId, { fresh });
          if (!playback?.is_streaming_active || !Object.keys(playback.provider_sources || {}).length) {
            preparedMatches.set(assignment.matchId, { ok: false, checkedAt: Date.now() });
            results.push({ ...result, ok: false, error: playback?.reason || 'stream_unavailable' });
            continue;
          }
          const viewerId = `prewarm:${assignment.matchId}`;
          const tried = new Set();
          let lease;
          let warmed = { ok: false, error: 'source_unavailable' };
          while (tried.size < Object.keys(playback.provider_sources || {}).length) {
            lease = providerPool.acquire(playback, viewerId);
            prewarmKeepalive.set(lease.key, viewerId);
            if (tried.has(lease.provider)) break;
            tried.add(lease.provider);
            try { warmed = await warmPlaybackManifest(playback, lease); }
            catch { warmed = { ok: false, error: 'upstream_unreachable' }; }
            if (warmed.ok) break;
            providerPool.fail(lease, warmed.status || 503);
            // Capacity errors need a free account; expired links also need urgent renewal.
            if (warmed.status !== 509 && tried.size === 1 && !fresh) {
              const renewed = await config.getPlaybackForSource('', assignment.matchId, { fresh: true });
              if (renewed?.is_streaming_active && renewed.channel_id === playback.channel_id) playback = renewed;
            }
          }
          if (warmed.ok) {
            providerPool.touch(lease, viewerId);
            prewarmKeepalive.set(lease.key, viewerId);
            currentKeys.add(lease.key);
          }
          preparedMatches.set(assignment.matchId, { ok: warmed.ok, channel: playback.channel_id, lease, checkedAt: Date.now() });
          results.push({ ...result, ...warmed });
        } catch (error) {
          preparedMatches.set(assignment.matchId, { ok: false, checkedAt: Date.now() });
          results.push({ ...result, ok: false, error: error instanceof PoolError ? error.code : (error?.message || 'prewarm_failed') });
        }
      }
      prewarmState.results = results.slice(-(config.prewarmMaxResources || 8));
      prewarmState.warmed = results.filter((item) => item.ok).length;
      prewarmState.failed = results.length - prewarmState.warmed;
      for (const key of [...prewarmKeepalive.keys()]) {
        if (!currentKeys.has(key)) {
          providerPool.releaseViewer(key, prewarmKeepalive.get(key));
          prewarmKeepalive.delete(key);
        }
      }
      return prewarmState;
    } finally {
      prewarmState.running = false;
    }
  };
  app.locals.prewarmAssignedResources = prewarmAssignedResources;

  registerOperatorConsole(app, {
    config, redis, clientIp,
    getMatches: async () => (await config.getMatchesForOrigin(config.frontend))
      .filter(row => isAllowedMatch({ league: row.league, leagueCountry: row.payload?.leagueCountry, homeTeam: row.home_team, awayTeam: row.away_team }) && sourceMatchState(row.payload || row) !== 'unavailable')
      .map(normalizeRuntimeMatch)
      .filter(row => moroccoPart(row.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === moroccoPart(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' }))
      .map(({ matchId, homeTeam, awayTeam, league, scheduledAt, time, score, status, isLive, sourceReady, viewingMode, channelName, broadcastRank, manuallySelected }) => ({ matchId, homeTeam, awayTeam, league, scheduledAt, time, score, status, isLive, sourceReady, viewingMode, channelName, broadcastRank, manuallySelected }))
      .sort((a, b) => Number(b.isLive) - Number(a.isLive) || (a.isLive ? Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt) : Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))),
    status: () => ({ accounts: (accountHealth?.snapshot() || []).map(({ provider, status, current_channel, last_http_code, cooldown_until }) => ({ provider, status, current_channel, last_http_code, cooldown_until })), prewarm: prewarmState, gateway: 'Oracle', player: 'Njalla', maxResources: 8 }),
    prepareChannel: async (channel, phase) => {
      if (!providerPool || !config.discoverOperatorChannel) throw new Error('channel_not_found');
      providerPool.rebalance();
      const accounts = config.providerAccounts();
      const available = PROVIDER_IDS.filter(id => accounts[id]?.enabled && !providerPool.leases.has(id)
        && (providerPool.blocked.get(id) || 0) <= Date.now());
      if (!available.length) throw new Error('no_free_provider');
      phase('discovering');
      const result = await config.discoverOperatorChannel(channel, available);
      if (!result?.resolvedChannel || !Object.keys(result.provider_sources || {}).length) throw new Error('channel_not_found');
      phase('testing_media');
      const viewer = `operator:${randomUUID()}`;
      let lease;
      try {
        const candidates = { ...result.provider_sources };
        let tested = false;
        while (Object.keys(candidates).length) {
          // A temporary identity prevents a probe from borrowing a busy channel lease.
          lease = providerPool.acquire({ match_id: viewer, pool_key: viewer, channel_id: viewer,
            provider_sources: candidates, priority_score: 1 }, viewer);
          let probe;
          try { probe = await warmPlaybackManifest({ channel_id: result.resolvedChannel }, lease); }
          catch { probe = { ok: false }; }
          if (probe.ok) { tested = true; break; }
          const failed = lease.provider;
          providerPool.releaseViewer(lease.key, viewer); lease = null;
          delete candidates[failed];
        }
        if (!tested) throw new Error('channel_probe_failed');
        await installPreparedOperatorChannel(result);
        config.refreshProviderCatalog();
        return { name: result.resolvedChannel };
      } finally { if (lease) providerPool.releaseViewer(lease.key, viewer); }
    },
    applyResources: async () => {
      await refreshOperatorResources();
      config.refreshProviderCatalog?.();
      await config.refreshMatchSnapshots?.();
      if (providerPool) {
        const wanted = new Set((config.providerAssignments?.().assignments || []).map(item => item.resolvedChannel));
        for (const lease of providerPool.leases.values()) {
          if (!wanted.has(lease.channel)) {
            providerPool.demands.delete(lease.key);
            providerPool.revoke(lease.provider);
          }
        }
      }
      while (prewarmState.running) await new Promise(resolve => setTimeout(resolve, 100));
      await prewarmAssignedResources('operator-change', { fresh: true });
    }
  });

  if (prewarmState.enabled) {
    const timer = setInterval(() => {
      prewarmAssignedResources('interval').catch((error) => {
        console.warn('[provider-prewarm] interval failed', { message: error?.message || String(error) });
      });
    }, config.prewarmIntervalMs || 60_000);
    timer.unref();
    app.locals.providerPrewarmTimer = timer;
    const heartbeatTimer = setInterval(() => {
      for (const [key, viewerId] of prewarmKeepalive) {
        const lease = [...providerPool.leases.values()].find((item) => item.key === key);
        if (lease) providerPool.touch(lease, viewerId);
      }
    }, 10_000);
    heartbeatTimer.unref();
    app.locals.providerPrewarmHeartbeatTimer = heartbeatTimer;
    const startupTimer = setTimeout(() => {
      prewarmAssignedResources('startup', { fresh: true }).catch((error) => {
        console.warn('[provider-prewarm] startup failed', { message: error?.message || String(error) });
      });
    }, 1500);
    startupTimer.unref();
    app.locals.providerPrewarmStartupTimer = startupTimer;
  }

  const accountAdmin = (req, res, next) => {
    const expected = createHmac('sha256', config.hmacSecret).update('koratv-account-admin-v1').digest('hex');
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!local || req.headers['x-forwarded-for'] || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.sendStatus(404);
    next();
  };
  app.get('/internal/accounts-status', accountAdmin, (req, res) => res.json({ accounts: accountHealth?.snapshot() || [] }));
  let probeRunning = false;
  app.post('/internal/accounts-probe', accountAdmin, async (req, res) => {
    if (!providerPool || !config.providerChannels || probeRunning) return res.sendStatus(409);
    probeRunning = true;
    const diagnosticLeases = new Map();
    const heartbeat = setInterval(() => {
      for (const [provider, lease] of diagnosticLeases) providerPool.touch(lease, `internal-diagnostic-${provider}`);
    }, 5000);
    heartbeat.unref();
    try {
      const channels = config.providerChannels();
      const used = new Set([...providerPool.leases.values()].map(lease => providerPool.demands.get(lease.key)?.channel));
      const jobs = PROVIDER_IDS.filter(provider => Object.values(channels).some(row => row[provider])).map(provider => {
        const held = providerPool.leases.get(provider);
        const demand = held && providerPool.demands.get(held.key);
        const channel = demand?.channel || Object.keys(channels).sort().find(name => channels[name][provider] && !used.has(name) && /^beIN SPORTS HD [1-9]$/.test(name));
        if (!channel) return { provider, error: 'no_distinct_channel_available' };
        used.add(channel);
        const source = held?.url || channels[channel][provider];
        return { provider, channel, playback: { match_id: demand?.key || `diagnostic:${provider}:${channel}`, pool_key: demand?.key || `diagnostic:${provider}:${channel}`,
          channel_id: channel, provider_sources: demand?.sources || { [provider]: source }, priority_score: demand?.base || 10 } };
      });
      const results = await Promise.all(jobs.map(async job => {
        if (job.error) return job;
        const result = { provider: job.provider, channel: job.channel };
        try {
          const lease = providerPool.acquire(job.playback, `internal-diagnostic-${job.provider}`);
          if (lease.provider !== job.provider) return { ...result, error: 'lease_changed' };
          diagnosticLeases.set(job.provider, lease);
          let url = new URL(lease.url), playlist = '';
          const headers = { 'User-Agent': config.upstreamUserAgent, Accept: '*/*' };
          for (let depth = 0; depth < 4; depth++) {
            const response = await fetchCachedUpstream(url, { headers, redirect: 'follow' }, '', lease);
            result.manifestStatus = response.status;
            if (!response.ok) {
              await response.body?.cancel();
              if ([401,403].includes(response.status)) providerPool.fail(lease, response.status);
              return result;
            }
            playlist = singleQualityManifest(await response.text());
            if (!playlist.trimStart().startsWith('#EXTM3U')) return { ...result, error: 'invalid_manifest' };
            const uri = playlist.split(/\r?\n/).find(line => line && !line.startsWith('#'));
            const base = response.url || url.href;
            if (playlist.includes('#EXT-X-STREAM-INF:')) { url = new URL(uri, base); continue; }
            const segment = playlist.split(/\r?\n/).filter(line => line && !line.startsWith('#')).at(-1);
            if (!segment) return { ...result, error: 'empty_playlist' };
            result.sequence = playlist.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] || null;
            const media = await fetchCachedUpstream(new URL(segment, base), { headers, redirect: 'follow' }, result.sequence || '', lease);
            result.segmentStatus = media.status; result.bytes = (await media.arrayBuffer()).byteLength;
            if ([401,403].includes(media.status)) providerPool.fail(lease, media.status);
            return result;
          }
          return { ...result, error: 'playlist_depth' };
        } catch (error) { return { ...result, error: error instanceof PoolError ? error.code : 'upstream_request_failed' }; }
      }));
      accountHealth?.persist();
      res.json({ results, accounts: accountHealth?.snapshot() || [] });
    } finally { clearInterval(heartbeat); probeRunning = false; }
  });

  app.get('/healthz', async (req, res) => {
    try {
      await redis.ping();
      res.json({ status: 'ok', hlsCache: hlsCache.stats(), ...(providerPool ? { providerPool: providerPool.snapshot(), providerFailures: providerPool.failures, providerPrewarm: prewarmState } : {}) });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  const servePlayerDocument = async (req, res) => {
    try {
      if (!canServePlayerDocument(req, frontendOrigins)) return res.sendStatus(403);
      const html = await readFile(new URL('./dist/739184.html', import.meta.url), 'utf8');
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': playerDocumentCsp,
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff'
      });
      res.send(html);
    } catch {
      res.sendStatus(404);
    }
  };
  app.get(['/739184.html', '/watch.html'], servePlayerDocument);
  app.get(/^\/[A-Za-z0-9]{10,24}$/, servePlayerDocument);

  const seal = (url, session) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(session));
    const payload = typeof url === 'string' ? url : JSON.stringify(url);
    const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  };
  const unseal = (value, session) => {
    const data = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(session));
    cipher.setAuthTag(data.subarray(12, 28));
    const plaintext = Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    if (plaintext.startsWith('{')) {
      try { return JSON.parse(plaintext); } catch { throw new Error('Invalid sealed resource'); }
    }
    return plaintext;
  };
  const allowedUrl = (value, runtimeOrigins = new Set(), options = {}) => {
    const url = new URL(value);
    const blockedHost = /^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?)$/i;
    const approved = options.sealed === true || config.upstreamOrigins.has(url.origin) || runtimeOrigins.has(url.origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || blockedHost.test(url.hostname) || !approved) throw new Error('Unapproved upstream');
    return url;
  };
  const publicQualities = (playback = {}) => {
    const seen = new Set();
    return (Array.isArray(playback.qualities) ? playback.qualities : [])
      .map((quality) => ({
        label: String(quality?.label || '').trim(),
        height: Number(quality?.height || 0)
      }))
      .filter((quality) => quality.label && !seen.has(quality.label) && seen.add(quality.label))
      .sort((a, b) => b.height - a.height);
  };
  const selectStreamUrl = (playback = {}, requestedQuality = '') => {
    const quality = String(requestedQuality || '').trim().toLowerCase();
    const sources = Array.isArray(playback.quality_sources) ? playback.quality_sources : [];
    const selected = sources.find((item) => String(item?.label || '').toLowerCase() === quality);
    return selected?.url || playback.stream_url;
  };
  const streamCandidates = (playback = {}, requestedQuality = '') => {
    const preferred = selectStreamUrl(playback, requestedQuality);
    const sources = Array.isArray(playback.quality_sources) ? playback.quality_sources : [];
    const urls = [
      preferred,
      playback.stream_url,
      ...sources.map((item) => item?.url)
    ].map((url) => String(url || '').trim()).filter(Boolean);
    return [...new Set(urls)];
  };
  const resolveRequestedMatchId = async (origin, value) => {
    const requested = String(value || '').trim();
    if (!/^\d{20}$/.test(requested)) return requested;
    return resolvePublicMatchId(requested, await config.getMatchesForOrigin(origin));
  };
  app.get('/api/config', async (req, res) => {
    try {
      const source = config.sourceForOrigin(originFromHeader(req.headers.origin));
      const matchId = await resolveRequestedMatchId(originFromHeader(req.headers.origin), req.query.matchId);
      if (req.query.matchId && !matchId) return res.status(404).json({ is_streaming_active: false });
      const playback = await config.getPlaybackForSource(source, matchId);
      res.json({ is_streaming_active: playback.is_streaming_active, reason: playback.reason || null });
    }
    catch { res.status(503).json({ is_streaming_active: false }); }
  });
  app.get('/api/matches', async (req, res) => {
    try {
      const origin = originFromHeader(req.headers.origin) || originFromHeader(req.headers.referer);
      const matches = dedupeNormalizedMatches((await config.getMatchesForOrigin(origin))
        .map(normalizeRuntimeMatch)
        .filter((match) => match.homeTeam && match.awayTeam && match.scheduledAt)
        .filter((match) => normalizeMatchName(match.homeTeam) !== normalizeMatchName(match.awayTeam)));
      const day = req.query.day;
      const today = moroccoPart(Date.now(), { year: 'numeric', month: '2-digit', day: '2-digit' });
      const tomorrow = moroccoPart(Date.now() + 86400000, { year: 'numeric', month: '2-digit', day: '2-digit' });
      const filtered = day === 'today'
        ? matches.filter((match) => moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === today)
        : day === 'tomorrow'
          ? matches.filter((match) => moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === tomorrow)
          : matches.filter((match) => [today, tomorrow].includes(moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' })));
      res.set('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=120');
      res.json({ matches: filtered.filter(allowedMatch) });
    } catch {
      res.status(503).json({ error: 'Match service is unavailable' });
    }
  });
  app.get('/api/match-info', async (req, res) => {
    try {
      const requested = String(req.query.matchId || '').trim();
      if (!requested || requested.length > 160) return res.sendStatus(400);
      const origin = originFromHeader(req.headers.origin) || originFromHeader(req.headers.referer);
      const matchId = await resolveRequestedMatchId(origin, requested);
      if (!matchId) return res.sendStatus(404);
      const match = (await config.getMatchesForOrigin(origin, matchId))
        .map(normalizeRuntimeMatch)
        .find((item) => (item.matchId === matchId || item.match_id === matchId) && allowedMatch(item));
      if (!match) return res.sendStatus(404);
      res.json({ match });
    } catch {
      res.status(503).json({ error: 'Match info is unavailable' });
    }
  });
  app.post('/api/generate-token', async (req, res) => {
    try {
      requireOrigin(req, tokenOrigins);
      const source = config.sourceForOrigin(originFromHeader(req.headers.origin));
      const requested = String(req.body.matchId || '').trim();
      if (!requested || requested.length > 160) return res.sendStatus(400);
      const requestedMatchId = await resolveRequestedMatchId(originFromHeader(req.headers.origin), requested);
      if (!requestedMatchId) return res.status(404).json({ error: 'match_unavailable' });
      let playback = await config.getPlaybackForSource(source, requestedMatchId);
      if (!playback.is_streaming_active && playback.reason === 'source_unavailable' && config.refreshProviderCatalog) {
        config.refreshProviderCatalog();
        prewarmAssignedResources('urgent-source-unavailable', { fresh: true }).catch((error) => {
          console.warn('[provider-prewarm] urgent refresh failed', { message: error?.message || String(error) });
        });
        playback = await config.getPlaybackForSource(source, requestedMatchId, { fresh: true });
      }
      if (!playback.is_streaming_active) return res.status(409).json({
        error: playback.reason || 'stream_unavailable',
        ...(playback.diagnostics ? { diagnostics: playback.diagnostics } : {})
      });
      if (playback.match_id !== requestedMatchId) return res.status(409).json({ error: 'match_mismatch' });
      const rateKey = `stream-rate:${ipHash(req)}:${Math.floor(Date.now() / 60000)}`;
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.expire(rateKey, 60);
      if (count > 20) return res.sendStatus(429);
      const token = sign({ ip: ipHash(req), channel: playback.channel_id, matchId: playback.match_id, source }, 'player-entry');
      res.json({ token, expiresIn: entryTtl, channelName: playback.channel_id });
    } catch { res.sendStatus(403); }
  });
  // Entry tickets are consumed atomically across workers; HLS sessions support repeated segment requests.
  app.post('/api/redeem-token', async (req, res) => {
    try {
      requireOrigin(req, config.player);
      const claims = verify(req.body.token, req, 'player-entry');
      const playback = await resolvePlayback(claims);
      if (!playback.is_streaming_active || playback.channel_id !== claims.channel) return res.sendStatus(403);
      const result = await redis.set(`stream-used:${claims.jti}`, '1', { NX: true, EX: entryTtl });
      if (result !== 'OK') return res.sendStatus(403);
      const sourceId = randomUUID();
      await redis.set(`stream-source:${sourceId}`, playback.stream_url, { EX: config.sessionTtl });
      res.json({
        token: sign({ ip: claims.ip, channel: claims.channel, matchId: claims.matchId, source: claims.source, sourceId }, 'hls-session', config.sessionTtl),
        expiresIn: config.sessionTtl,
        qualities: providerPool ? [] : publicQualities(playback),
        singleQuality: !!providerPool,
        channelName: claims.channel
      });
    } catch { res.sendStatus(403); }
  });
  app.get('/api/pool-heartbeat', async (req, res) => {
    try {
      rejectUnexpectedOrigin(req, config.player);
      const claims = verify(requestToken(req), req, 'hls-session');
      if (!providerPool) return res.json({ enabled: false });
      const playback = await resolvePlayback(claims);
      if (!playback.is_streaming_active || playback.channel_id !== claims.channel) return res.sendStatus(403);
      const lease = providerPool.acquire(playback, claims.jti);
      res.json({ enabled: true, provider: lease.provider });
    } catch (error) {
      if (error instanceof PoolError) return res.status(error.status).set('Retry-After', '3').json({ error: error.code });
      res.sendStatus(403);
    }
  });
  app.get(['/api/stream.m3u8', '/api/resource'], async (req, res) => {
    let claims;
    let sessionToken = '';
    try {
      rejectUnexpectedOrigin(req, config.player);
      sessionToken = requestToken(req);
      claims = verify(sessionToken, req, 'hls-session');
      if (!claims.sourceId) return res.sendStatus(403);
    } catch { return res.sendStatus(403); }
    try {
      let playback = null;
      let lease = null;
      let candidateSources = null;
      if (req.path === '/api/stream.m3u8' || providerPool) {
        playback = await resolvePlayback(claims);
        if (!playback.is_streaming_active || playback.channel_id !== claims.channel) return res.sendStatus(403);
        if (providerPool) lease = providerPool.acquire(playback, claims.jti);
        candidateSources = lease ? [lease.mediaUrl || lease.url] : streamCandidates(playback, req.query.quality);
        if (!candidateSources.length) return res.sendStatus(403);
        await redis.set(`stream-source:${claims.sourceId}`, candidateSources[0], { EX: config.sessionTtl });
      }
      const rootSource = await redis.get(`stream-source:${claims.sourceId}`);
      if (!rootSource) return res.sendStatus(403);
      const headers = {
        'User-Agent': config.upstreamUserAgent,
        Accept: '*/*'
      };
      if (req.headers.range) headers.Range = req.headers.range;
      const rootUrls = req.path === '/api/stream.m3u8' ? candidateSources : [rootSource];
      let source;
      let upstream;
      let runtimeOrigins;
      let cacheVersion = '';
      let resourceLeaseId = '';
      for (const sourceHref of rootUrls) {
        const rootUrl = new URL(sourceHref);
        runtimeOrigins = new Set([rootUrl.origin]);
        if (req.path === '/api/stream.m3u8') {
          source = allowedUrl(sourceHref, runtimeOrigins);
        } else {
          const sealedResource = unseal(req.query.resource, claims.jti);
          const descriptor = typeof sealedResource === 'string' ? { url: sealedResource } : sealedResource;
          if (lease && descriptor.leaseId !== lease.id) throw new PoolError('pool_reassigned', 409);
          resourceLeaseId = lease?.id || '';
          source = allowedUrl(descriptor.url, runtimeOrigins, { sealed: true });
          cacheVersion = String(descriptor.version || '');
        }
        runtimeOrigins.add(source.origin);
        const attemptedProviders = new Set();
        let retriedProviderEntry = false;
        while (true) {
          try {
            upstream = await fetchCachedUpstream(source, { headers, redirect: 'follow' }, cacheVersion, lease);
          } catch (error) {
            if (error instanceof PoolError) throw error;
            if (lease && req.path === '/api/resource') {
              if (hlsResourceKind(source) === 'segment' && (lease.transientFailures || 0) < 3) {
                return res.sendStatus(502);
              }
              console.warn('[stream-proxy] upstream resource failed, asking player to reconnect', {
                provider: lease.provider,
                message: error?.message || String(error),
                kind: hlsResourceKind(source),
                source: source.origin
              });
              providerPool.fail(lease, 503);
              throw new PoolError('pool_reassigned', 409);
            }
            if (!lease || req.path !== '/api/stream.m3u8') throw error;
            if (lease.mediaUrl && lease.mediaUrl !== lease.url && !retriedProviderEntry) {
              retriedProviderEntry = true;
              lease.mediaUrl = '';
              source = allowedUrl(lease.url, new Set([new URL(lease.url).origin]));
              continue;
            }
            console.warn('[stream-proxy] upstream provider failed before response, trying alternate', {
              provider: lease.provider,
              message: error?.message || String(error),
              source: source.origin
            });
            attemptedProviders.add(lease.provider);
            providerPool.fail(lease, 503);
            if (attemptedProviders.size >= PROVIDER_IDS.length) throw new PoolError('pool_upstream_unavailable');
            const replacement = providerPool.acquire(playback, claims.jti);
            lease = replacement;
            runtimeOrigins = new Set([new URL(lease.url).origin]);
            source = allowedUrl(lease.url, runtimeOrigins);
            cacheVersion = '';
            continue;
          }
          if (!lease || !failoverStatus(upstream.status)) break;
          await upstream.body?.cancel();
          if (req.path === '/api/stream.m3u8' && lease.mediaUrl && lease.mediaUrl !== lease.url && !retriedProviderEntry) {
            retriedProviderEntry = true;
            lease.mediaUrl = '';
            source = allowedUrl(lease.url, new Set([new URL(lease.url).origin]));
            continue;
          }
          if (req.path === '/api/resource' && hlsResourceKind(source) === 'segment'
            && retryableStatus(upstream.status) && (lease.transientFailures || 0) < 3) return res.sendStatus(502);
          attemptedProviders.add(lease.provider);
          providerPool.fail(lease, upstream.status);
          if (attemptedProviders.size >= PROVIDER_IDS.length) throw new PoolError('pool_upstream_unavailable');
          if (req.path !== '/api/stream.m3u8') throw new PoolError('pool_reassigned', 409);
          const replacement = providerPool.acquire(playback, claims.jti);
          lease = replacement;
          runtimeOrigins = new Set([new URL(lease.url).origin]);
          source = allowedUrl(lease.url, runtimeOrigins);
          cacheVersion = '';
        }
        if (upstream.ok) {
          if (req.path === '/api/stream.m3u8' && sourceHref !== rootSource) {
            await redis.set(`stream-source:${claims.sourceId}`, lease?.url || sourceHref, { EX: config.sessionTtl });
          }
          break;
        }
        console.error('[stream-proxy] upstream rejected request', {
          status: upstream.status,
          source: source.origin,
          type: upstream.headers.get('content-type') || ''
        });
        await upstream.body?.cancel();
      }
      if (!upstream.ok) {
        return res.sendStatus(502);
      }
      if (resourceLeaseId && lease?.id !== resourceLeaseId) throw new PoolError('pool_reassigned', 409);
      const type = upstream.headers.get('content-type') || '';
      if (/mpegurl/i.test(type) || source.pathname.endsWith('.m3u8')) {
        // Relative segments belong to the final playlist URL after redirects.
        if (upstream.url) {
          runtimeOrigins.add(new URL(upstream.url).origin);
        }
        let rawText = await upstream.text();
        if (providerPool && lease && hlsResourceKind(source) === 'manifest' && !rawText.includes('#EXT-X-STREAM-INF:')) {
          const progress = hlsProgress.observe(lease.provider, playback.channel_id, rawText);
          if (progress.stalled) {
            const failedProvider = lease.provider;
            config.refreshProviderCatalog?.();
            const refreshed = await resolvePlayback(claims, { fresh: true });
            if (!refreshed?.is_streaming_active || refreshed.channel_id !== playback.channel_id) {
              throw new PoolError('stalled_channel_unavailable', 503);
            }
            playback = refreshed;
            lease = providerPool.acquire(refreshed, claims.jti);
            if (lease.provider !== failedProvider) throw new PoolError('lease_changed_during_catalog_refresh', 503);
            let refreshedProgress = { stalled: true };
            if (refreshed.provider_sources?.[failedProvider]) {
              if (!providerPool.updateSource(lease, refreshed.provider_sources[failedProvider])) {
                throw new PoolError('catalog_source_refresh_failed', 503);
              }
              source = allowedUrl(lease.url, new Set([new URL(lease.url).origin]));
              upstream = await fetchLeasedUpstream(source, { headers, redirect: 'follow' }, lease);
              if (!upstream.ok) {
                if ([401, 403].includes(upstream.status)) providerPool.fail(lease, upstream.status);
                await upstream.body?.cancel();
                throw new PoolError('refreshed_source_unavailable', 503);
              }
              rawText = await upstream.text();
              refreshedProgress = hlsProgress.observe(lease.provider, playback.channel_id, rawText);
            }
            if (refreshedProgress.stalled) {
              providerPool.failStalled(lease);
              lease = providerPool.acquire(refreshed, claims.jti);
              if (lease.provider === failedProvider) throw new PoolError('no_healthy_alternate_account', 503);
              source = allowedUrl(lease.url, new Set([new URL(lease.url).origin]));
              upstream = await fetchLeasedUpstream(source, { headers, redirect: 'follow' }, lease);
              if (!upstream.ok) {
                if ([401, 403].includes(upstream.status)) providerPool.fail(lease, upstream.status);
                await upstream.body?.cancel();
                throw new PoolError('alternate_account_unavailable', 503);
              }
              rawText = await upstream.text();
            }
            await redis.set(`stream-source:${claims.sourceId}`, lease.url, { EX: config.sessionTtl });
          }
        }
        runtimeOrigins.add(source.origin);
        if (upstream.url) runtimeOrigins.add(new URL(upstream.url).origin);
        const manifestUrl = allowedUrl(upstream.url || source.href, runtimeOrigins);
        if (lease && !rawText.includes('#EXT-X-STREAM-INF:')) {
          lease.mediaUrl = manifestUrl.href;
          const progress = hlsProgress.observe(lease.provider, playback.channel_id, rawText);
          const timeline = `${lease.id}:${progress.epoch || 0}`;
          const timelineKey = `hls-timeline:${claims.jti}`;
          const previous = await redis.get(timelineKey);
          await redis.set(timelineKey, timeline, { EX: config.sessionTtl });
          // Never append a restarted encoder/source to a viewer's old MSE timeline.
          if (previous && previous !== timeline) throw new PoolError('hls_timeline_changed', 409);
        }
        const text = providerPool ? singleQualityManifest(rawText) : rawText;
        if (!text.trimStart().startsWith('#EXTM3U')) {
          console.error('[stream-proxy] upstream response is not an HLS manifest', {
            source: source.origin,
            type
          });
          return res.sendStatus(502);
        }
        const mediaSequence = Number(text.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m)?.[1]);
        const hasMediaSequence = Number.isSafeInteger(mediaSequence) && mediaSequence >= 0;
        const manifestVersion = hasMediaSequence ? '' : createHash('sha256').update(text).digest('hex').slice(0, 16);
        let segmentIndex = 0;
        const prefetch = [];
        const rewrite = (uri, version = '') => {
          const target = allowedUrl(new URL(uri, manifestUrl).href, runtimeOrigins);
          if (hlsResourceKind(target) === 'segment' && version) prefetch.push({ target, version });
          const url = new URL(`${resourceApiOrigin(req, config)}/api/resource`);
          url.searchParams.set('resource', seal({ url: target.href, version, ...(lease ? { leaseId: lease.id } : {}) }, claims.jti));
          url.searchParams.set('token', sessionToken);
          return url.href;
        };
        const manifest = text.split(/\r?\n/).map((line) => {
          if (!line.trim()) return line;
          if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewrite(uri)}"`);
          const uri = line.trim();
          const target = allowedUrl(new URL(uri, manifestUrl).href, runtimeOrigins);
          if (hlsResourceKind(target) !== 'segment') return rewrite(uri);
          const version = hasMediaSequence ? `msn-${mediaSequence + segmentIndex}` : `mf-${manifestVersion}-${segmentIndex}`;
          segmentIndex += 1;
          return rewrite(uri, version);
        }).join('\n');
        for (const { target, version } of prefetch.slice(-Math.max(1, Number(process.env.HLS_PREFETCH_SEGMENTS || 2)))) {
          const prefetchHeaders = { 'User-Agent': config.upstreamUserAgent, Accept: '*/*' };
          hlsCache.schedulePrefetch(
            `${lease ? `${lease.id}:` : ''}segment:${target.href}:${version}`,
            { ttlMs: cacheTtl('segment') },
            () => fetchLeasedUpstream(target, { headers: prefetchHeaders, redirect: 'follow' }, lease)
          );
        }
        return res.type('application/vnd.apple.mpegurl').send(manifest);
      }
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upstream.headers.has(name)) res.set(name, upstream.headers.get(name));
      }
      res.status(upstream.status);
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (error instanceof PoolError && !res.headersSent) return res.status(error.status).set('Retry-After', '3').json({ error: error.code });
      console.error('[stream-proxy] failed to proxy stream', {
        path: req.path,
        message: error?.message || String(error)
      });
      if (!res.headersSent) res.sendStatus(502);
      else res.destroy();
    }
  });
  app.use((error, req, res, next) => { if (!res.headersSent) res.sendStatus(400); else next(error); });
  return app;
}
