import { sameFixture, teamIdentity } from './match-broadcasts.mjs';

// Keep schedule/channel identity separate from the detailed sports-data provider.
export function attachApiFootballDetails(row, apiRows) {
  const sourceId = row.payload?.sourceMatchId;
  const candidates = apiRows.filter(candidate => candidate.source === 'api-football'
    && sourceId && candidate.payload?.broadcast?.sourceMatchId === sourceId
    && sameFixture(row, candidate));
  if (candidates.length !== 1) return { ...row, payload: { ...row.payload, detailsState: 'unmatched_fixture' } };
  const api = candidates[0];
  const p = api.payload || {};
  const reverse = teamIdentity(row.home_team) !== teamIdentity(api.home_team);
  const orient = value => reverse && value && typeof value === 'object'
    ? { home: value.away, away: value.home } : value;
  const scoreParts = String(p.score || '').match(/^(\d+)\s*-\s*(\d+)$/);
  const score = scoreParts && reverse ? `${scoreParts[2]} - ${scoreParts[1]}` : p.score;
  return { ...row, payload: {
    ...row.payload,
    ...Object.fromEntries(['events', 'lineups', 'venue', 'venueCity', 'referee', 'standings',
      'eventDetailsLoaded', 'detailsUpdatedAt', 'standingsUpdatedAt', 'standingsVersion', 'sourceFixtureId', 'status', 'isLive', 'isFinished', 'liveMinute']
      .filter(key => Object.hasOwn(p, key)).map(key => [key, p[key]])),
    ...(score ? { score } : {}),
    statistics: reverse ? [...(p.statistics || [])].reverse() : p.statistics || [],
    yellowCards: orient(p.yellowCards), redCards: orient(p.redCards),
    goals: (p.goals || []).map(goal => ({ ...goal, team: reverse ? (goal.team === 'home' ? 'away' : goal.team === 'away' ? 'home' : goal.team) : goal.team })),
    homeTeamId: reverse ? p.awayTeamId : p.homeTeamId,
    awayTeamId: reverse ? p.homeTeamId : p.awayTeamId,
    dataSource: 'api-football', detailsState: p.eventDetailsLoaded ? 'ready' : 'pending',
  } };
}
