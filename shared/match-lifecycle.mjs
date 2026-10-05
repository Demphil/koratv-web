const endedStatuses = new Set(['RESULT', 'FINISHED', 'ENDED', 'FULL TIME', 'FT', 'AET', 'PEN', 'MATCH FINISHED', 'انتهت', 'انتهى', 'نهاية المباراة']);
const liveStatuses = new Set(['LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'SUSP', 'IN PLAY', 'IN PROGRESS', 'HALF TIME', 'مباشر', 'جارية']);
const waitingStatuses = new Set(['FIXTURE', 'NS', 'TBD', 'NOT STARTED', 'SCHEDULED']);
const unavailableStatuses = new Set(['PST', 'POSTPONED', 'CANC', 'CANCELLED', 'CANCELED', 'ABD', 'ABANDONED', 'AWD', 'WO']);

export function nextMoroccoMidnight(reference = Date.now()) {
  const parts = value => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const current = parts(reference);
  const local = Date.UTC(current.year, current.month - 1, current.day + 1);
  const seen = parts(local);
  const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  return local - (seenUtc - local);
}

export function matchListCacheControl(now = Date.now()) {
  const remaining = Math.max(0, Math.floor((nextMoroccoMidnight(now) - now) / 1000));
  const shared = Math.min(30, remaining);
  return `public, max-age=${Math.min(15, remaining)}, s-maxage=${shared}, stale-while-revalidate=${Math.min(120, Math.max(0, remaining - shared))}`;
}

export function sourceMatchState(payload = {}) {
  const raw = payload.status || payload.state || payload.matchStatus || '';
  const status = String(typeof raw === 'object' ? raw.short || raw.long || '' : raw)
    .trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (endedStatuses.has(status)) return 'ended';
  if (liveStatuses.has(status)) return 'live';
  if (unavailableStatuses.has(status)) return 'unavailable';
  if (waitingStatuses.has(status)) return 'upcoming';
  if (payload.isLive === true) return 'live';
  if (payload.isFinished === true) return 'ended';
  return 'unknown';
}

export function matchPlaybackState(row, { now = Date.now(), opensBeforeMinutes = 20 } = {}) {
  const payload = row.payload || row;
  const state = sourceMatchState(payload);
  if (state === 'ended' || state === 'live') return state;
  if (state === 'unavailable') return 'upcoming';
  const kickoff = Date.parse(row.kickoff_time || payload.scheduledAt || '');
  if (!Number.isFinite(kickoff)) return 'upcoming';
  // Time can open the preparation window, but only the provider can end a match.
  return now >= kickoff - Math.max(0, opensBeforeMinutes) * 60_000 ? 'live' : 'upcoming';
}

export function frontendMatchState(match, diffMinutes) {
  const state = sourceMatchState(match);
  if (state === 'live' || state === 'ended') return state;
  if (state === 'unavailable') return 'upcoming';
  if (['live', 'ended', 'upcoming'].includes(match.playbackState)) return match.playbackState;
  return match.isLive === true || diffMinutes <= 0 ? 'live' : 'upcoming';
}
