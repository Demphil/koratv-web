import { sourceMatchState } from './match-lifecycle.mjs';
import { isEuropeanYouthLeague } from './match-visibility.mjs';

const MAX_SNAPSHOT_AGE_MS = 30 * 60_000;
const MAX_SCHEDULE_AGE_MS = 48 * 60 * 60_000;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

function nameOf(value) {
  return typeof value === 'object' && value ? value.name : value;
}

function logoOf(value, fallback = '') {
  const logo = typeof value === 'object' && value ? value.logo : fallback;
  try {
    const url = new URL(logo);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function normalizeWebsiteMatch(input = {}) {
  const row = input && typeof input === 'object' ? input : {};
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const homeName = nameOf(row.homeTeam ?? row.home_team);
  const awayName = nameOf(row.awayTeam ?? row.away_team);
  const scheduledAt = row.scheduledAt || row.kickoff_time || '';
  if (typeof homeName !== 'string' || typeof awayName !== 'string' || !Number.isFinite(Date.parse(scheduledAt))
    || homeName.trim().toLocaleLowerCase('ar') === awayName.trim().toLocaleLowerCase('ar')) return null;
  if (isEuropeanYouthLeague(row.league || payload.league)) return null;

  const state = sourceMatchState({ ...payload, ...row, scheduledAt });
  const isLive = row.isLive === true || payload.isLive === true || state === 'live';
  const isFinished = payload.isFinished === true || state === 'ended';
  const isPaused = row.broadcastPaused === true || row.resourceStatus === 'PAUSED';
  const channelName = String(row.channelName || row.channel || payload.channel || '').trim();
  const homeValue = row.homeTeam ?? row.home_team;
  const awayValue = row.awayTeam ?? row.away_team;

  return {
    ...row,
    matchId: row.matchId || row.match_id || row.id,
    homeTeam: { name: homeName, logo: logoOf(homeValue, payload.homeLogo) },
    awayTeam: { name: awayName, logo: logoOf(awayValue, payload.awayLogo) },
    scheduledAt,
    time: row.time || payload.time || '',
    score: row.score || payload.score || 'VS',
    league: row.league || payload.league || '',
    status: row.status || payload.status || '',
    isFinished,
    channelName,
    channel: channelName,
    streams: [],
    broadcastPaused: isPaused,
    sourceReady: row.sourceReady === true && !isPaused,
    sourceAvailable: !isPaused && (row.sourceAvailable === true || Boolean(channelName)),
    playbackState: row.playbackState || (isFinished ? 'ended' : isLive ? 'live' : ''),
    isLive,
    liveMinute: row.liveMinute ?? payload.liveMinute ?? null,
    liveExtraMinute: Math.max(0, Number(row.liveExtraMinute ?? payload.liveExtraMinute) || 0),
    commentator: row.commentator || payload.commentator || '',
    yellowCards: row.yellowCards || payload.yellowCards || null,
    redCards: row.redCards || payload.redCards || null,
    goals: Array.isArray(row.goals) ? row.goals : Array.isArray(payload.goals) ? payload.goals : [],
  };
}

export function parsePublicMatchSnapshot(body, { now = Date.now(), maxAgeMs = MAX_SNAPSHOT_AGE_MS } = {}) {
  if (!body || body.version !== 1 || !Array.isArray(body.matches) || body.matches.length > 5000) {
    throw new Error('Invalid public match snapshot');
  }
  const generatedAt = Date.parse(body.generatedAt || '');
  const age = now - generatedAt;
  if (!Number.isFinite(age) || age < -5 * 60_000 || age > maxAgeMs) throw new Error('Public match snapshot is stale');
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error('Public match snapshot exceeds size limit');
  }

  return body.matches
    .filter(row => row?.active !== false && row?.source === 'kooora')
    .map(normalizeWebsiteMatch)
    .filter(Boolean);
}

function safeOrigin(value, label) {
  try {
    const url = new URL(String(value || ''));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new Error(`Invalid ${label} origin`); }
}

const FEED_REF_URL = 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed';
const FEED_REF_CACHE_KEY = 'public_kooora_feed_ref_v1';
const FEED_REF_CACHE_TTL_MS = 10 * 60_000;
const feedRefMemoryCache = new WeakMap();

function safeSnapshotUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com'
      || url.username || url.password
      || url.pathname !== '/Demphil/koratv-web/public-match-feed/site-metadata/matches.json') throw new Error();
    return url;
  } catch { throw new Error('Invalid public GitHub match-feed URL'); }
}

function readCachedFeedRef(fetchImpl, now) {
  const memory = feedRefMemoryCache.get(fetchImpl);
  if (memory && memory.expiresAt > now) return memory.sha;
  try {
    const stored = JSON.parse(localStorage.getItem(FEED_REF_CACHE_KEY) || 'null');
    if (/^[a-f0-9]{40}$/i.test(stored?.sha || '') && stored.expiresAt > now) {
      feedRefMemoryCache.set(fetchImpl, stored);
      return stored.sha;
    }
  } catch {}
  return '';
}

async function resolveImmutableSnapshotUrl(snapshotTarget, { fetchImpl, force, now }) {
  const cachedSha = readCachedFeedRef(fetchImpl, now);
  if (cachedSha) return new URL(snapshotTarget.href.replace('/public-match-feed/', `/${cachedSha}/`));

  const response = await fetchImpl(FEED_REF_URL, {
    cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`GitHub feed version status ${response.status}`);
  const ref = await response.json();
  const sha = ref?.object?.sha;
  if (ref?.ref !== 'refs/heads/public-match-feed' || ref?.object?.type !== 'commit' || !/^[a-f0-9]{40}$/i.test(sha || '')) {
    throw new Error('Invalid GitHub feed version');
  }

  const cached = { sha, expiresAt: now + FEED_REF_CACHE_TTL_MS };
  feedRefMemoryCache.set(fetchImpl, cached);
  try { localStorage.setItem(FEED_REF_CACHE_KEY, JSON.stringify(cached)); } catch {}
  return new URL(snapshotTarget.href.replace('/public-match-feed/', `/${sha}/`));
}

async function fetchSnapshot(target, { fetchImpl, force, now, mutable = false, onStaleSchedule }) {
  const suffix = force && mutable ? `?t=${now}` : '';
  const response = await fetchImpl(`${target.href}${suffix}`, {
    cache: force ? 'no-store' : 'default', credentials: 'omit',
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Static match feed status ${response.status}`);
  const body = await response.json();
  try { return parsePublicMatchSnapshot(body, { now }); }
  catch (error) {
    if (onStaleSchedule) {
      try {
        const rows = parsePublicMatchSnapshot(body, { now, maxAgeMs: MAX_SCHEDULE_AGE_MS });
        const matches = rows.map(row => sourceMatchState(row) === 'ended'
          ? { ...row, snapshotStale: true, sourceReady: false }
          : { ...row, snapshotStale: true, scheduleOnly: true, status: 'FIXTURE', playbackState: 'upcoming',
            isLive: false, isFinished: false, broadcastPaused: false, resourceStatus: undefined,
            sourceReady: false, sourceAvailable: false, score: 'VS', liveMinute: null, liveExtraMinute: 0,
            yellowCards: null, redCards: null, goals: [],
            payload: { ...row.payload, status: 'FIXTURE', isLive: false, isFinished: false, score: 'VS',
              liveMinute: null, liveExtraMinute: 0, yellowCards: null, redCards: null, goals: [], events: [], statistics: [] } });
        if (matches.length) onStaleSchedule(matches, Date.parse(body.generatedAt));
      } catch {}
    }
    throw error;
  }
}

export async function loadWebsiteMatchFeed(apiOrigin, {
  snapshotUrl = 'https://raw.githubusercontent.com/Demphil/koratv-web/public-match-feed/site-metadata/matches.json',
  fetchImpl = fetch, force = false, now = Date.now(),
} = {}) {
  const apiBase = safeOrigin(apiOrigin, 'match API');
  const snapshotTarget = safeSnapshotUrl(snapshotUrl);
  let snapshotError;
  let scheduleFallback;
  const onStaleSchedule = (matches, generatedAt) => {
    if (!scheduleFallback || generatedAt > scheduleFallback.generatedAt) scheduleFallback = { matches, generatedAt };
  };

  // Live polls use the small cached public file, not an old pinned Git commit or the streaming API.
  if (force) {
    try {
      return await fetchSnapshot(new URL('/site-metadata/matches.json', apiBase), { fetchImpl, force, now, onStaleSchedule });
    } catch (error) { snapshotError = error; }
  }

  try {
    const immutableTarget = await resolveImmutableSnapshotUrl(snapshotTarget, { fetchImpl, force, now });
    return await fetchSnapshot(immutableTarget, { fetchImpl, force, now, onStaleSchedule });
  } catch (error) { snapshotError = error; }

  try {
    return await fetchSnapshot(snapshotTarget, { fetchImpl, force, now, mutable: true, onStaleSchedule });
  } catch (error) { snapshotError = new Error(`${snapshotError.message}; mutable snapshot failed (${error.message})`); }

  try {
    return await fetchSnapshot(new URL('/site-metadata/matches.json', apiBase), { fetchImpl, force, now, onStaleSchedule });
  } catch (error) { snapshotError = new Error(`${snapshotError.message}; metadata snapshot failed (${error.message})`); }

  try {
    const response = await fetchImpl(`${apiBase}/api/matches${force ? `?t=${now}` : ''}`, {
      cache: force ? 'no-store' : 'default', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Match API status ${response.status}`);
    const body = await response.json();
    return (Array.isArray(body.matches) ? body.matches : []).map(normalizeWebsiteMatch).filter(Boolean);
  } catch (error) {
    if (scheduleFallback) return scheduleFallback.matches;
    if (snapshotError) throw new Error(`Static match feed failed (${snapshotError.message}); API fallback failed (${error.message})`);
    throw error;
  }
}

