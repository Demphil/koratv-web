import test from 'node:test';
import assert from 'node:assert/strict';
import { attachApiFootballDetails } from '../../shared/match-details.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const row = { match_id: 'kooora-match', source: 'kooora', home_team: 'جبل طارق', away_team: 'آندورا',
  kickoff_time: '2026-09-27T16:00:00Z', channel: 'beIN SPORTS HD 4',
  payload: { sourceMatchId: 'event', broadcast: { source: 'kooora', channels: ['beIN Sports Mena 4'] } } };
const api = { match_id: 'api-match', source: 'api-football', home_team: 'Gibraltar', away_team: 'Andorra',
  kickoff_time: row.kickoff_time, channel: 'must-not-be-copied', payload: {
    broadcast: { sourceMatchId: 'event' }, sourceFixtureId: 42, homeTeamId: 1, awayTeamId: 2,
    eventDetailsLoaded: true, score: '2 - 1', yellowCards: { home: 1, away: 2 },
    events: [{ player: 'Player', type: 'Card' }], lineups: [{ team: { id: 1 }, startXI: [{ name: 'Player' }] }],
    statistics: [{ team: { id: 1 } }, { team: { id: 2 } }], standings: [{ team: 'Gibraltar', points: 3 }],
  } };

test('Kooora identity and channel remain unchanged while card details come from API-Football', () => {
  const merged = attachApiFootballDetails(row, [api]);
  assert.equal(merged.match_id, row.match_id);
  assert.equal(merged.channel, row.channel);
  assert.equal(merged.payload.broadcast, row.payload.broadcast);
  assert.equal(merged.payload.dataSource, 'api-football');
  assert.equal(merged.payload.homeTeamId, 1);
  assert.equal(merged.payload.lineups[0].startXI[0].name, 'Player');
});

test('reversed source display order preserves lineup sides, score and cards', () => {
  const merged = attachApiFootballDetails({ ...row, home_team: row.away_team, away_team: row.home_team }, [api]);
  assert.equal(merged.payload.homeTeamId, 2);
  assert.equal(merged.payload.score, '1 - 2');
  assert.deepEqual(merged.payload.yellowCards, { home: 2, away: 1 });
  assert.equal(merged.payload.statistics[0].team.id, 2);
});

test('detail enrichment cannot replace Kooora score, minute or end a live fixture', () => {
  const live = { ...row, payload: { ...row.payload, score: '1 - 0', status: 'LIVE', isLive: true, isFinished: false, liveMinute: 90, liveExtraMinute: 3 } };
  const stale = { ...api, payload: { ...api.payload, score: '0 - 1', status: 'FT', isLive: false, isFinished: true, liveMinute: 116 } };
  const merged = attachApiFootballDetails(live, [stale]);
  for (const key of ['score', 'status', 'isLive', 'isFinished', 'liveMinute', 'liveExtraMinute']) assert.equal(merged.payload[key], live.payload[key]);
  assert.equal(merged.payload.sourceFixtureId, 42);
});

test('mismatched fixture identity and ambiguous matches cannot supply card data', () => {
  for (const candidates of [[{ ...api, away_team: 'England' }], [api, api], [{ ...api, payload: { ...api.payload, broadcast: { sourceMatchId: 'different' } } }]]) {
    const merged = attachApiFootballDetails(row, candidates);
    assert.equal(merged.payload.detailsState, 'unmatched_fixture');
    assert.equal(merged.payload.lineups, undefined);
  }
});

test('pitch centers the goalkeeper and distributes defenders without overlapping columns', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const start = source.indexOf('function positionLineup(');
  const end = source.indexOf('function lineupForSide(', start);
  const players = ['1:1', '2:1', '2:2', '2:3', '2:4', '3:1'].map(grid => ({ grid }));
  const positioned = vm.runInNewContext(`${source.slice(start, end)}; positionLineup(players)`, { players });
  assert.equal(positioned[0].pitchSlot.x, 50);
  assert.equal(positioned[1].pitchSlot.x, 20);
  assert.equal(positioned[4].pitchSlot.x, 80);
  assert.equal(new Set(positioned.map(p => `${p.pitchSlot.x}:${p.pitchSlot.y}`)).size, players.length);
});

test('team switching reuses the positioned panel renderer for pointer and keyboard input', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  assert.match(source, /selectedLineupSide = side.dataset.lineupSide;\s+renderMatchPanel\(\)/);
  assert.match(source, /selectedLineupSide = node.dataset.lineupSide;\s+if \(currentMatchInfo\) renderMatchPanel\(\)/);
  assert.doesNotMatch(source, /detail.innerHTML = renderLineups/);
});

test('standings retain zero points and zero goal difference', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const start = source.indexOf('function escapeHtml(');
  const end = source.indexOf('async function loadWatchNews(', start);
  const escape = vm.runInNewContext(`${source.slice(start, end)}; escapeHtml`);
  assert.equal(escape(0), '0');
  assert.equal(escape(null), '');
  assert.equal(escape('<team>'), '&lt;team&gt;');
});
