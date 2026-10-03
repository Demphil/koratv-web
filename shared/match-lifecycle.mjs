const endedStatuses = new Set(['RESULT', 'FINISHED', 'ENDED', 'FULL TIME', 'FT', 'AET', 'PEN', 'MATCH FINISHED', 'انتهت', 'انتهى', 'نهاية المباراة']);
const liveStatuses = new Set(['LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'SUSP', 'IN PLAY', 'IN PROGRESS', 'HALF TIME', 'مباشر', 'جارية']);
const waitingStatuses = new Set(['FIXTURE', 'NS', 'TBD', 'NOT STARTED', 'SCHEDULED']);
const unavailableStatuses = new Set(['PST', 'POSTPONED', 'CANC', 'CANCELLED', 'CANCELED', 'ABD', 'ABANDONED', 'AWD', 'WO']);

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
