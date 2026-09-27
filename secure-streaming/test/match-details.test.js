import test from "node:test";
import assert from "node:assert/strict";
process.env.API_FOOTBALL_KEY ||= "test-only-key";
process.env.MATCH_SOURCE_PROVIDER = "api-football";
const {
  enrichApiFootballMatchDetails,
  mergeMatchPayload,
  normalizeApiFootballEvents,
  normalizeApiFootballLineups,
  normalizeApiFootballStandings,
  normalizeApiFootballStatistics
} = await import("../scripts/sync-matches-from-source.js");

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
