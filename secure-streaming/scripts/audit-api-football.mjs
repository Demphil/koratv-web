import '../src/lib/loadEnv.js';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin.js';
import { sameFixture, teamIdentity } from '../../shared/match-broadcasts.mjs';
import { isAllowedMatch } from '../../shared/league-whitelist.mjs';

const key = process.env.API_FOOTBALL_KEY || process.env.APIFOOTBALL_KEY || process.env.FOOTBALL_API_KEY || process.env.RAPIDAPI_KEY;
if (!key) throw new Error('API-Football credential is not configured');
const base = (process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io').replace(/\/+$/, '');
const date = process.env.API_AUDIT_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
async function request(path, parameters) {
  const url = new URL(base + path);
  for (const [name, value] of Object.entries(parameters || {})) url.searchParams.set(name, value);
  const headers = { 'x-apisports-key': key };
  if (/rapidapi/i.test(base)) Object.assign(headers, { 'x-rapidapi-key': key, 'x-rapidapi-host': url.host });
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  console.log(JSON.stringify({ endpoint: path, status: response.status, results: body.results,
    remaining: response.headers.get('x-ratelimit-requests-remaining'), errorKinds: Object.keys(body.errors || {}) }));
  if (!response.ok || Object.keys(body.errors || {}).length) return [];
  return body.response || [];
}
const fixtures = await request('/fixtures', { date, timezone: 'Africa/Casablanca' });
const { data: stored, error } = await getSupabaseAdmin().from(process.env.SUPABASE_MATCHES_TABLE || 'matches')
  .select('match_id,source,home_team,away_team,kickoff_time,league,payload,updated_at')
  .gte('kickoff_time', `${date}T00:00:00+01:00`).lte('kickoff_time', `${date}T23:59:59+01:00`);
if (error) throw new Error(`Storage audit failed (${error.code})`);
const moroccan = fixtures.filter(item => item.league?.country === 'Morocco');
for (const fixture of moroccan) {
  const api = { home_team: fixture.teams.home.name, away_team: fixture.teams.away.name, kickoff_time: fixture.fixture.date, league: fixture.league.name };
  const sameTime = (stored || []).filter(row => row.source === 'kooora' && Math.abs(Date.parse(row.kickoff_time) - Date.parse(api.kickoff_time)) <= 15 * 60000);
  console.log(JSON.stringify({ fixture: fixture.fixture.id, league: fixture.league, teams: fixture.teams, date: fixture.fixture.date,
    admitted: isAllowedMatch({ league: fixture.league.name, leagueCountry: fixture.league.country, homeTeam: api.home_team, awayTeam: api.away_team }),
    matches: sameTime.map(row => ({ id: row.match_id, home: row.home_team, away: row.away_team, exact: sameFixture(row, api),
      homeIdentity: teamIdentity(row.home_team), apiHomeIdentity: teamIdentity(api.home_team) })),
    stored: (stored || []).filter(row => row.payload?.sourceFixtureId === fixture.fixture.id).map(row => ({ id: row.match_id,
      lineups: row.payload?.lineups?.length, statistics: row.payload?.statistics?.length, events: row.payload?.events?.length,
      loaded: row.payload?.eventDetailsLoaded, refreshed: row.payload?.detailsUpdatedAt, updated: row.updated_at })) }));
}
const ids = [...moroccan.filter(item => item.league?.id === 200), ...moroccan.filter(item => item.league?.id !== 200)]
  .slice(0, 5).map(item => item.fixture.id);
if (ids.length) {
  for (const item of await request('/fixtures', { ids: ids.join('-') })) console.log(JSON.stringify({ detail: item.fixture?.id,
    home: item.teams?.home?.name, away: item.teams?.away?.name, events: item.events?.length,
    lineups: item.lineups?.map(lineup => ({ team: lineup.team?.id, players: lineup.startXI?.length })), statistics: item.statistics?.length }));
  const league = moroccan[0].league;
  for (const item of await request('/leagues', { id: String(league.id), season: String(league.season) })) {
    console.log(JSON.stringify({ leagueCoverage: item.league, seasons: item.seasons }));
  }
  const selected = moroccan.find(item => /Raja/i.test(item.teams?.home?.name || ''));
  if (selected) {
    const lineups = await request('/fixtures/lineups', { fixture: String(selected.fixture.id) });
    console.log(JSON.stringify({ dedicatedLineups: selected.fixture.id,
      teams: lineups.map(item => ({ team: item.team?.id, players: item.startXI?.length })) }));
  }
}
