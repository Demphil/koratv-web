import { readFileSync } from 'node:fs';
import { teamIdentity, normalizeBroadcastChannel } from '../shared/match-broadcasts.mjs';
import { normalizeTeamName } from '../shared/league-whitelist.mjs';

export const priorityMatrix = JSON.parse(readFileSync(new URL('./priority-matrix.json', import.meta.url), 'utf8'));
const normalize = value => normalizeTeamName(String(value || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tiers = priorityMatrix.tiers.map(tier => ({ ...tier,
  teams: new Set([...tier.teams, ...(tier.nationalTeams || [])].map(teamIdentity)),
  leagues: tier.leagues.map(normalize),
  channels: new Set(tier.channels.map(value => normalize(normalizeBroadcastChannel(value)))),
  regions: new Set((tier.nationalRegions || []).map(code => `country:${code}`)),
}));

export function basePriority(match = {}, channel = '') {
  const teams = [teamIdentity(match.home_team || match.homeTeam), teamIdentity(match.away_team || match.awayTeam)];
  const league = normalize(match.league);
  for (const tier of tiers) {
    if (teams.some(team => tier.teams.has(team) || tier.regions.has(team))
      || tier.leagueIds.includes(Number(match.payload?.leagueId || match.leagueId))
      || tier.leagues.some(name => league === name || league.startsWith(`${name} `))
      || tier.channels.has(normalize(normalizeBroadcastChannel(channel)))) return tier.score;
  }
  return 10;
}
