import { sourceMatchState } from './match-lifecycle.mjs';
import { isEuropeanYouthLeague } from './match-visibility.mjs';

const MAX_SNAPSHOT_AGE_MS = 30 * 60_000;
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

function safeSnapshotUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com'
      || url.username || url.password
      || url.pathname !== '/Demphil/koratv-web/public-match-feed/site-metadata/matches.json') throw new Error();
    return url.href;
  } catch { throw new Error('Invalid public GitHub match-feed URL'); }
}

export async function loadWebsiteMatchFeed(apiOrigin, {
  snapshotUrl = 'https://raw.githubusercontent.com/Demphil/koratv-web/public-match-feed/site-metadata/matches.json',
  fetchImpl = fetch, force = false, now = Date.now(),
} = {}) {
  const apiBase = safeOrigin(apiOrigin, 'match API');
  const snapshotTarget = new URL(safeSnapshotUrl(snapshotUrl));
  const cache = force ? 'no-store' : 'default';
  const suffix = force ? `?t=${now}` : '';
  let snapshotError;

  try {
    const response = await fetchImpl(`${snapshotTarget.href}${suffix}`, {
      cache, credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Static match feed status ${response.status}`);
    const matches = parsePublicMatchSnapshot(await response.json(), { now });
    return matches;
  } catch (error) { snapshotError = error; }

  try {
    const response = await fetchImpl(`${apiBase}/api/matches${suffix}`, {
      cache, credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Match API status ${response.status}`);
    const body = await response.json();
    return (Array.isArray(body.matches) ? body.matches : []).map(normalizeWebsiteMatch).filter(Boolean);
  } catch (error) {
    if (snapshotError) throw new Error(`Static match feed failed (${snapshotError.message}); API fallback failed (${error.message})`);
    throw error;
  }
}

