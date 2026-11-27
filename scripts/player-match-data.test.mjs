import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshMatchData, resolveFixture, mergeFixture, safeImage } from './player-match-data.mjs';
import { publicMatchId } from '../shared/public-match-id.mjs';
const now = Date.parse('2026-11-27T20:05:00Z');
const row = { source: 'kooora', match_id: 'kooora_2026-11-27_بريست_vs_باريس',
  home_team: 'بريست', away_team: 'باريس', league: 'الدوري الفرنسي', kickoff_time: '2026-11-27T19:45:00Z',
  payload: { status: '1H', score: '1 - 0', homeLogo: 'https://cdn.sportfeeds.io/home.png', awayLogo: 'https://cdn.sportfeeds.io/away.png' } };
const fixture = { fixture: { id: 1234, date: row.kickoff_time, status: { short: '1H', elapsed: 20 },
  referee: 'Referee', venue: { name: 'Stadium', city: 'Brest' } },
  league: { name: 'Ligue 1' }, teams: {
    home: { id: 106, name: 'Brest', logo: 'https://media.api-sports.io/football/teams/106.png' },
    away: { id: 114, name: 'Paris FC', logo: 'https://media.api-sports.io/football/teams/114.png' }
  }, goals: { home: 1, away: 0 },
  statistics: [{ team: { id: 106 }, statistics: [{ type: 'Ball Possession', value: '55%' }] },
    { team: { id: 114 }, statistics: [{ type: 'Ball Possession', value: '45%' }] }],
  events: [{ type: 'Goal', detail: 'Normal Goal', time: { elapsed: 12 }, player: { name: 'Player' }, team: { id: 106 } }],
  lineups: [{ team: { id: 106 }, formation: '4-3-3', coach: { name: 'Coach' }, startXI: [{ player: { name: 'Player', number: 9, grid: '3:2' } }] }]
};
const snapshot = (time = now, rows = [row]) => ({ version: 1, generatedAt: new Date(time).toISOString(), matches: rows });

test('missing API key still exposes both real schedule logos without inventing detailed statistics', async () => {
  const result = await refreshMatchData({ snapshot: snapshot(), now });
  const match = result.publicData.matches[publicMatchId(row.match_id)];
  assert.equal(match.homeLogo, row.payload.homeLogo); assert.equal(match.awayLogo, row.payload.awayLogo);
  assert.equal(match.dataSource, 'kooora'); assert.equal(match.detailsState, 'not_configured');
  assert.deepEqual(match.statistics, []); assert.equal(result.diagnostics.apiConfigured, false);
  assert.ok(!JSON.stringify(result.publicData).includes('quota'));
});

test('matching binds the exact two teams and kickoff; Paris FC cannot become PSG or a youth fixture', () => {
  assert.equal(resolveFixture(row, [fixture]).fixture.fixture.id, 1234);
  assert.equal(resolveFixture(row, [{ ...fixture, teams: { ...fixture.teams, away: { id: 85, name: 'Paris Saint Germain' } } }]), null);
  assert.equal(resolveFixture(row, [{ ...fixture, fixture: { ...fixture.fixture, date: '2026-11-27T20:30:00Z' } }]), null);
  assert.equal(resolveFixture(row, [{ ...fixture, league: { name: 'Ligue 1 U19' } }]), null);
  assert.equal(resolveFixture(row, [fixture, { ...fixture, fixture: { ...fixture.fixture, id: 1235 } }]), null);
});

test('one lookup and one bundled detail request serve subsequent worker runs without viewer-triggered calls', async () => {
  const calls = [];
  const client = { request: async (path, params) => { calls.push([path, params]); return [fixture]; } };
  const first = await refreshMatchData({ snapshot: snapshot(), client, now });
  assert.equal(calls.length, 2);
  const match = first.publicData.matches[publicMatchId(row.match_id)];
  assert.equal(match.dataSource, 'api-football'); assert.equal(match.homeTeamId, 106);
  assert.equal(match.score, '1 - 0'); assert.equal(match.venue, 'Stadium'); assert.equal(match.events[0].team, 'بريست');
  assert.equal(match.lineups[0].startXI[0].name, 'Player');
  await refreshMatchData({ snapshot: snapshot(now + 120000), state: first.state, client, now: now + 120000 });
  assert.equal(calls.length, 2);
  const next = await refreshMatchData({ snapshot: snapshot(now + 600000), state: first.state, client, now: now + 600000 });
  assert.equal(calls.length, 3); assert.equal(next.diagnostics.matched, 1);
});

test('a pre-event lookup does not prevent the one pre-match detailed warmup', async () => {
  const early = now - 3 * 60 * 60000, calls = [];
  const client = { request: async (path, params) => { calls.push(params); return [{ ...fixture, fixture: { ...fixture.fixture, status: { short: 'NS' } } }]; } };
  const first = await refreshMatchData({ snapshot: snapshot(early), now: early, client });
  assert.equal(calls.length, 1);
  const pregame = Date.parse(row.kickoff_time) - 20 * 60000;
  const second = await refreshMatchData({ snapshot: snapshot(pregame), state: first.state, now: pregame, client });
  assert.equal(calls.length, 2);
  await refreshMatchData({ snapshot: snapshot(pregame + 120000), state: second.state, now: pregame + 120000, client });
  assert.equal(calls.length, 2);
});

test('finished fixture is fetched once, while request failures preserve context and back off', async () => {
  let calls = 0;
  const ended = { ...fixture, fixture: { ...fixture.fixture, status: { short: 'FT' } } };
  const client = { request: async () => { calls++; return [ended]; } };
  const first = await refreshMatchData({ snapshot: snapshot(), now, client });
  await refreshMatchData({ snapshot: snapshot(now + 3600000), state: first.state, now: now + 3600000, client });
  assert.equal(calls, 2);
  const broken = { request: async () => { calls++; throw new Error('quota exhausted'); } };
  const failed = await refreshMatchData({ snapshot: snapshot(), now, client: broken });
  const before = calls;
  const retry = await refreshMatchData({ snapshot: snapshot(now + 120000), state: failed.state, now: now + 120000, client: broken });
  assert.equal(calls, before); assert.equal(retry.publicData.matches[publicMatchId(row.match_id)].homeTeam, 'بريست');
});

test('stale schedules cannot spend quota, and expired or malformed schedules are rejected', async () => {
  const client = { request: () => { throw new Error('must not request'); } };
  const result = await refreshMatchData({ snapshot: snapshot(now - 3600000), now, client });
  assert.equal(result.publicData.matches[publicMatchId(row.match_id)].snapshotStale, true);
  await assert.rejects(refreshMatchData({ snapshot: snapshot(now - 49 * 3600000), now, client }), /expired/);
  assert.equal(safeImage('javascript:alert(1)'), ''); assert.equal(safeImage('https://evil.test/logo.png'), '');
});

test('reversed provider orientation does not swap team logos, scores or statistics incorrectly', () => {
  const reversed = { ...fixture, teams: { home: fixture.teams.away, away: fixture.teams.home }, goals: { home: 0, away: 1 } };
  const found = resolveFixture(row, [reversed]); assert.equal(found.reverse, true);
  const match = mergeFixture({ homeTeam: 'بريست', awayTeam: 'باريس', playbackState: 'live' }, { ...found, checkedAt: now }, now);
  assert.equal(match.homeTeamId, 106); assert.equal(match.score, '1 - 0');
  assert.match(match.homeLogo, /106\.png$/); assert.equal(match.statistics[0].statistics[0].value, '55%');
});
