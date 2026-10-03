import test from "node:test";
import assert from "node:assert/strict";
process.env.API_FOOTBALL_KEY ||= "test-only-key";
process.env.MATCH_SOURCE_PROVIDER = "api-football";
const {
  enrichApiFootballMatchDetails,
  apiFootballDetailTargets,
  mergeMatchPayload,
  normalizeApiFootballEvents,
  normalizeApiFootballLineups,
  normalizeApiFootballStandings,
  normalizeApiFootballStatistics
} = await import("../scripts/sync-matches-from-source.js");
const { normalizeKnockoutFixtures } = await import('../../shared/knockout.mjs');

test('player ratings use the existing fixture response and exact team/player identities', () => {
  const lineups = [{team:{id:1,name:'Home'},startXI:[{player:{id:9,name:'Player'}},{player:{id:10,name:'Other'}}]}];
  const stats = [{team:{id:2},players:[{player:{id:9},statistics:[{games:{rating:'9.9'}}]}]},
    {team:{id:1},players:[{player:{id:9},statistics:[{games:{rating:'6.7'}}]},{player:{id:10},statistics:[{games:{rating:'99'}}]}]}];
  const normalized = normalizeApiFootballLineups(lineups,stats);
  assert.equal(normalized[0].startXI[0].rating,6.7);
  assert.equal(normalized[0].startXI[1].rating,null);
  assert.equal(normalizeApiFootballLineups(lineups)[0].startXI[0].rating,null);
});

test('knockout bracket includes only the exact competition, season and announced final rounds', () => {
  const fixture = (id,round,league=1,season=2026) => ({fixture:{id,date:'2026-10-03T18:30:00Z',status:{short:'FT'}},
    league:{id:league,season,round},teams:{home:{name:'Home'},away:{name:'Away'}},goals:{home:0,away:0}});
  const bracket = normalizeKnockoutFixtures([fixture(1,'Semi-finals'),fixture(2,'Semi-finals'),fixture(3,'Quarter-finals'),
    fixture(4,'Final',2),fixture(5,'Final',1,2025)],1,2026);
  assert.equal(bracket.rounds[0].matches.length,2);
  assert.equal(bracket.rounds[0].matches[0].score,'0 - 0');
  assert.equal(bracket.rounds[1].matches.length,0,'unknown final is not invented');
  assert.equal(normalizeKnockoutFixtures([fixture(3,'Regular Season - 1')],1,2026),null);
});

test('background bracket refresh is cached four hours and does not invent missing finals', async () => {
  const originalFetch=globalThis.fetch, calls=[];
  const now=Date.now();
  const row={home_team:'Home',away_team:'Away',kickoff_time:new Date(now-600000).toISOString(),payload:{
    sourceFixtureId:1,leagueId:7,season:2026,leagueRound:'Semi-finals',isLive:true,
    standingsVersion:2,standingsUpdatedAt:new Date(now).toISOString(),detailsUpdatedAt:new Date(now).toISOString()}};
  globalThis.fetch=async url=>{
    calls.push(new URL(url));
    return new Response(JSON.stringify({response:[1,2].map(id=>({fixture:{id,date:new Date(now).toISOString()},
      league:{id:7,season:2026,round:'Semi-finals'},teams:{home:{name:`Home ${id}`},away:{name:`Away ${id}`}},goals:{home:0,away:0}}))}),{status:200});
  };
  try {
    await enrichApiFootballMatchDetails([row]);
    await enrichApiFootballMatchDetails([row]);
    assert.equal(calls.filter(url => url.pathname === '/fixtures').length,1);
    assert.equal(calls.find(url => url.pathname === '/fixtures').searchParams.get('league'),'7');
    assert.equal(row.payload.knockout.rounds[0].matches.length,2);
    assert.equal(row.payload.knockout.rounds[1].matches.length,0);
  } finally {globalThis.fetch=originalFetch;}
});

test("refreshing a fixture retains cached details while replacing current score data", () => {
  const previous = {
    detailsUpdatedAt: "2026-09-26T12:00:00.000Z",
    eventDetailsLoaded: true,
    lineups: [{ team: { name: "Home" }, startXI: [{ player: { name: "Player" } }] }],
    channelResolvedBy: "admin"
  };
  const refreshed = mergeMatchPayload(previous, { score: "2 - 1", status: "2H" });

  assert.equal(refreshed.score, "2 - 1");
  assert.equal(refreshed.detailsUpdatedAt, previous.detailsUpdatedAt);
  assert.equal(refreshed.lineups, previous.lineups);
  assert.equal(refreshed.channelResolvedBy, "admin");
});

test("API-Football detail normalization keeps useful player and event fields bounded", () => {
  const lineups = normalizeApiFootballLineups([{
    team: { id: 7, name: "Home", logo: "https://media.api-sports.io/football/teams/7.png" },
    formation: "4-3-3",
    coach: { name: "Coach", photo: "https://media.api-sports.io/football/coachs/3.png" },
    startXI: [
      { player: { id: 9, name: "Forward", number: 9, pos: "F", grid: "1:3", photo: "https://media.api-sports.io/football/players/9.png" } },
      { player: { id: 10, name: "Fallback Photo", photo: "https://example.com/player.png" } },
      { player: { name: "No Photo", photo: "https://example.com/player.png" } }
    ]
  }]);
  const events = normalizeApiFootballEvents([{
    time: { elapsed: 64, extra: 2 }, team: { name: "Home" }, player: { name: "Forward" },
    assist: { name: "Midfielder" }, type: "Goal", detail: "Normal Goal"
  }]);
  const statistics = normalizeApiFootballStatistics([{
    team: { id: 7, name: "Home" }, statistics: [{ type: "Ball Possession", value: "58%" }]
  }]);

  assert.equal(lineups[0].startXI[0].grid, "1:3");
  assert.equal(lineups[0].startXI[0].photo, "https://media.api-sports.io/football/players/9.png");
  assert.equal(lineups[0].startXI[1].photo, "https://media.api-sports.io/football/players/10.png");
  assert.equal(lineups[0].startXI[2].photo, "");
  assert.equal(events[0].elapsed, 64);
  assert.equal(events[0].assist, "Midfielder");
  assert.equal(statistics[0].statistics[0].value, "58%");
});

test("standings are reduced to the fields used by the match panel", () => {
  const standings = normalizeApiFootballStandings([[{
    rank: 1, points: 42, goalsDiff: 17, form: "WWDWW",
    team: { name: "Home FC", id: 5 }, all: { played: 18 }
  }]]);

  assert.deepEqual(standings[0], {
    rank: 1, team: "Home FC", points: 42, played: 18, goalDifference: 17, form: "WWDWW"
  });
});

test("two live fixtures and their lineups are enriched by one batched fixture request", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const now = Date.now();
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    const body = parsed.pathname.endsWith("/standings") ? {
      response: [{ league: { standings: [[{ rank: 1, points: 12, goalsDiff: 4, team: { id: 1, name: "Home" }, all: { played: 4 } }, { rank: 2, team: { id: 2, name: "Away" } }]] } }]
    } : {
      response: [101, 202].map((id) => ({
        fixture: { id, venue: { name: "City Stadium", city: "Rabat" }, referee: "Official" },
        events: [{ time: { elapsed: 31 }, team: { name: id === 101 ? "Home" : "Home 2" }, player: { name: "Scorer" }, type: "Goal", detail: "Normal Goal" }],
        lineups: [{ team: { id: 1, name: "Home", logo: "https://media.api-sports.io/football/teams/1.png" }, formation: "4-3-3", startXI: [{ player: { id: 9, name: "Forward", number: 9, pos: "F", grid: "1:3", photo: "https://media.api-sports.io/football/players/9.png" } }], substitutes: [] }],
        statistics: [{ team: { id: 1, name: "Home" }, statistics: [{ type: "Ball Possession", value: "54%" }] }]
      }))
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const rows = [101, 202].map((id, index) => ({
      home_team: index ? "Home 2" : "Home", away_team: index ? "Away 2" : "Away",
      kickoff_time: new Date(now - 10 * 60_000).toISOString(),
      payload: { sourceFixtureId: id, leagueId: 39, season: 2026, isLive: true, homeTeamId: 1, awayTeamId: 2 }
    }));
    await enrichApiFootballMatchDetails(rows);

    assert.equal(requests.filter((url) => url.pathname.endsWith("/fixtures")).length, 1);
    assert.equal(requests.find((url) => url.pathname.endsWith("/fixtures")).searchParams.get("ids"), "101-202");
    assert.equal(requests.filter((url) => url.pathname.endsWith("/standings")).length, 1);
    assert.equal(requests.some((url) => url.pathname.endsWith("/fixtures/events")), false);
    assert.equal(rows[0].payload.lineups[0].startXI[0].photo, "https://media.api-sports.io/football/players/9.png");
    assert.equal(rows[0].payload.statistics[0].statistics[0].value, "54%");
    assert.equal(rows[0].payload.standings[0].team, "Home");
    assert.equal(rows[1].payload.events[0].player, "Scorer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('standings select the fixture group before truncation, not the first 40 unrelated teams', () => {
  const unrelated = Array.from({ length: 40 }, (_, i) => ({ team: { id: i + 10, name: `Other ${i}` } }));
  const wanted = [{ team: { id: 1, name: 'Gibraltar' }, rank: 2 }, { team: { id: 2, name: 'Andorra' }, rank: 3 }];
  const rows = normalizeApiFootballStandings([unrelated, wanted], { payload: { homeTeamId: 1, awayTeamId: 2 } });
  assert.deepEqual(rows.map(row => row.team), ['Gibraltar', 'Andorra']);
});

test('details scheduler retries finished partial fixtures and cannot starve rows beyond the first batch', () => {
  const now = Date.now();
  const rows = Array.from({ length: 25 }, (_, i) => ({ source: 'api-football', kickoff_time: new Date(now - 3600000).toISOString(),
    payload: { sourceFixtureId: i + 1, isLive: true } }));
  assert.equal(apiFootballDetailTargets(rows, now).length, 25);
  const selected = apiFootballDetailTargets(rows, now, 20);
  selected.forEach(row => { row.payload.detailsCheckedAt = new Date(now).toISOString(); });
  assert.equal(apiFootballDetailTargets(rows, now, 20)[0].payload.sourceFixtureId, 21);
  const finished = { ...rows[0], payload: { sourceFixtureId: 101, isFinished: true, eventDetailsLoaded: true,
    detailsUpdatedAt: new Date(now - 3600000).toISOString() } };
  assert.equal(apiFootballDetailTargets([finished], now).length, 1);
  finished.payload.finalDetailsComplete = true;
  assert.equal(apiFootballDetailTargets([finished], now).length, 0);
});

test('25 due fixtures use two bounded batches and empty refreshes preserve existing lineups', async () => {
  const original = globalThis.fetch, requests = [];
  const now = Date.now();
  const rows = Array.from({ length: 25 }, (_, index) => ({ source: 'api-football', home_team: 'Home', away_team: 'Away',
    kickoff_time: new Date(now - 600000).toISOString(), payload: { sourceFixtureId: index + 1, isLive: true,
      lineups: [{ team: { id: 1 }, startXI: [{ id: 9, name: 'Retained player' }] }], detailsUpdatedAt: '2020-01-01T00:00:00Z' } }));
  globalThis.fetch = async url => {
    const parsed = new URL(url), ids = parsed.searchParams.get('ids').split('-');
    requests.push(ids);
    return new Response(JSON.stringify({ response: ids.map(id => ({ fixture: { id: Number(id) }, events: [], lineups: [], statistics: [] })) }));
  };
  try {
    await enrichApiFootballMatchDetails(rows);
    assert.deepEqual(requests.map(ids => ids.length), [20, 5]);
    assert.equal(rows[0].payload.lineups[0].startXI[0].name, 'Retained player');
    assert.equal(rows[0].payload.detailStates.lineups, 'stale');
    assert.equal(rows[0].payload.detailsUpdatedAt, '2020-01-01T00:00:00Z');
    assert.equal(rows[0].payload.finalDetailsComplete, false);
  } finally { globalThis.fetch = original; }
});

test('coverage distinguishes unsupported lineups from delayed data and skips unsupported standings', async () => {
  const original = globalThis.fetch, calls = [];
  const now = Date.now();
  const row = { source: 'api-football', kickoff_time: new Date(now - 600000).toISOString(), payload: {
    sourceFixtureId: 2001, leagueId: 200, season: 2026, isLive: true } };
  globalThis.fetch = async url => {
    const parsed = new URL(url); calls.push(parsed.pathname);
    return new Response(JSON.stringify({ response: parsed.pathname === '/leagues'
      ? [{ league: { id: 200 }, seasons: [{ year: 2026, coverage: { fixtures: { lineups: false, events: true, statistics_fixtures: true }, standings: false } }] }]
      : [{ fixture: { id: 2001 }, events: [], lineups: [], statistics: [] }] }));
  };
  try {
    await enrichApiFootballMatchDetails([row]);
    assert.equal(row.payload.detailStates.lineups, 'not_covered');
    assert.equal(row.payload.detailStates.events, 'pending');
    assert.equal(row.payload.eventDetailsLoaded, false);
    assert.equal(calls.includes('/standings'), false);
    await enrichApiFootballMatchDetails([row]);
    assert.equal(calls.filter(path => path === '/leagues').length, 1);
  } finally { globalThis.fetch = original; }
});

test('supported empty batch lineups use a bounded dedicated fallback by exact fixture ID', async () => {
  const original = globalThis.fetch, now = Date.now(), calls = [];
  const row = { source: 'api-football', kickoff_time: new Date(now - 600000).toISOString(), payload: {
    sourceFixtureId: 991, isLive: true, homeTeamId: 1, awayTeamId: 2, apiCoverage: { lineups: true, statistics: false },
    leagueId: 200, season: 2026, coverageUpdatedAt: new Date(now).toISOString(), standingsCheckedAt: new Date(now).toISOString() } };
  globalThis.fetch = async url => {
    const parsed = new URL(url); calls.push(parsed);
    return new Response(JSON.stringify({ response: parsed.pathname === '/fixtures/lineups'
      ? [{ team: { id: 1 }, startXI: [{ player: { id: 10, name: 'Official player' } }] }]
      : [{ fixture: { id: 991 }, teams: { home: { id: 1 }, away: { id: 2 } }, lineups: [] }] }));
  };
  try {
    await enrichApiFootballMatchDetails([row]);
    assert.equal(row.payload.lineups[0].startXI[0].name, 'Official player');
    assert.equal(calls.find(url => url.pathname === '/fixtures/lineups').searchParams.get('fixture'), '991');
    assert.equal(row.payload.detailStates.lineups, 'available');
  } finally { globalThis.fetch = original; }
});
