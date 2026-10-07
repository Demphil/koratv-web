import { teamIdentity } from './match-broadcasts.mjs';
import { normalizeTeamName } from './league-whitelist.mjs';
import { moroccoMatchDay } from './operator-imported-match.mjs';
import { sourceMatchState } from './match-lifecycle.mjs';

export function validateMatchSearch(input, now = Date.now()) {
  const names = [input?.homeTeam, input?.awayTeam];
  if (names.some(value => typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 80
    || /[<>/\\\r\n\x00-\x1f]|https?:/i.test(value))) throw new Error('invalid_team_names');
  const [homeTeam, awayTeam] = names.map(value => value.trim());
  if (teamIdentity(homeTeam) === teamIdentity(awayTeam)) throw new Error('invalid_team_names');
  return { homeTeam, awayTeam, day: moroccoMatchDay(now) };
}

function matchesName(requested, actual) {
  if (teamIdentity(requested) === teamIdentity(actual)) return true;
  const normalize = value => normalizeTeamName(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wanted = normalize(requested), found = ` ${normalize(actual)} `;
  return Boolean(wanted && found.includes(` ${wanted} `));
}

export function findRequestedMatches(rows, query) {
  return rows.filter(row => moroccoMatchDay(row.kickoff_time) === query.day
    && ((matchesName(query.homeTeam, row.home_team) && matchesName(query.awayTeam, row.away_team))
      || (matchesName(query.homeTeam, row.away_team) && matchesName(query.awayTeam, row.home_team))))
    .sort((a, b) => Number(sourceMatchState(a.payload) === 'unavailable') - Number(sourceMatchState(b.payload) === 'unavailable')
      || Number(sourceMatchState(b.payload) === 'live') - Number(sourceMatchState(a.payload) === 'live')
      || Date.parse(a.kickoff_time) - Date.parse(b.kickoff_time));
}
