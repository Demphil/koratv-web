import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWebsiteMatchFeed, normalizeWebsiteMatch, parsePublicMatchSnapshot } from '../shared/public-match-feed.mjs';

test('fresh Njalla snapshots become lightweight Kooora website cards', () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const matches = parsePublicMatchSnapshot({ version: 1, generatedAt: new Date(now - 30_000).toISOString(), matches: [
    { id: 'fixture-1', match_id: 'fixture-1', source: 'kooora', active: true,
      home_team: 'المغرب', away_team: 'مالي', league: 'مباريات ودية دولية', kickoff_time: '2026-11-13T20:00:00Z',
      payload: { score: '1 - 0', status: 'LIVE', isLive: true, liveMinute: 33,
        homeLogo: 'https://cdn.example/morocco.png', goals: [{ player: 'Player', minute: '20', team: 'home' }] } },
    { id: 'fixture-2', match_id: 'fixture-2', source: 'api-football', active: true,
      home_team: 'Paris', away_team: 'Madrid', league: 'UEFA Champions League', kickoff_time: '2026-11-13T20:00:00Z', payload: {} },
  ] }, { now });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchId, 'fixture-1');
  assert.deepEqual(matches[0].homeTeam, { name: 'المغرب', logo: 'https://cdn.example/morocco.png' });
  assert.equal(matches[0].playbackState, 'live');
  assert.equal(matches[0].score, '1 - 0');
  assert.equal(matches[0].liveMinute, 33);
  assert.equal(matches[0].sourceReady, false);
  assert.equal(matches[0].goals[0].player, 'Player');
});

test('snapshot freshness, bounds, and youth-competition exclusion fail closed', () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const base = { version: 1, generatedAt: new Date(now).toISOString(), matches: [] };
  assert.deepEqual(parsePublicMatchSnapshot(base, { now }), []);
  assert.throws(() => parsePublicMatchSnapshot({ ...base, generatedAt: new Date(now - 11 * 60_000).toISOString() }, { now }), /stale/);
  assert.throws(() => parsePublicMatchSnapshot({ ...base, matches: Array(5001).fill({}) }, { now }), /Invalid/);

  const youth = normalizeWebsiteMatch({ source: 'kooora', home_team: 'Real Madrid U19', away_team: 'Roma U19',
    league: 'UEFA Youth League', kickoff_time: '2026-11-13T20:00:00Z', payload: { status: 'FIXTURE' } });
  assert.equal(youth, null);

  const cancelled = normalizeWebsiteMatch({ source: 'kooora', home_team: 'Home', away_team: 'Away',
    league: 'الدوري الإنجليزي الممتاز', kickoff_time: '2026-11-13T17:00:00Z', payload: { status: 'CANC' } });
  assert.equal(cancelled.status, 'CANC');
  assert.equal(cancelled.isLive, false);
});

test('the compatibility feed normalizer also accepts the former API summary shape', () => {
  const match = normalizeWebsiteMatch({ matchId: 'api-fixture', homeTeam: { name: 'Home', logo: 'https://cdn.example/home.png' },
    awayTeam: { name: 'Away' }, scheduledAt: '2026-11-13T20:00:00Z', status: 'FIXTURE', score: 'VS' });
  assert.equal(match.matchId, 'api-fixture');
  assert.equal(match.homeTeam.logo, 'https://cdn.example/home.png');
  assert.equal(match.playbackState, '');
});

test('the Njalla snapshot is the primary read and the legacy endpoint is only a fallback', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const match = { id: 'kooora-1', match_id: 'kooora-1', source: 'kooora', active: true, home_team: 'Home', away_team: 'Away',
    league: 'الدوري الإنجليزي الممتاز', kickoff_time: '2026-11-13T20:00:00Z', payload: { status: 'FIXTURE' } };
  const rows = await loadWebsiteMatchFeed('https://feed.example/', { now, force: true, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [match] });
  } });
  assert.equal(rows[0].matchId, 'kooora-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `https://feed.example/site-metadata/matches.json?t=${now}`);
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].cache, 'no-store');
});

test('the public Njalla feed is independent from the website API origin', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const rows = await loadWebsiteMatchFeed('https://korafabor.pro', {
    snapshotOrigin: 'https://stream-api.koratv.click', now,
    fetchImpl: async url => {
      calls.push(url);
      return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [
        { id: 'central-feed', source: 'kooora', active: true, home_team: 'Home', away_team: 'Away',
          league: 'International Friendlies', kickoff_time: '2026-11-13T20:00:00Z', payload: {} },
      ] });
    },
  });
  assert.deepEqual(calls.map(url => new URL(url).origin), ['https://stream-api.koratv.click']);
  assert.equal(rows[0].matchId, 'central-feed');
});

test('a valid empty snapshot does not send avoidable traffic to the legacy API', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const rows = await loadWebsiteMatchFeed('https://feed.example', { now, fetchImpl: async url => {
    calls.push(url);
    return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [] });
  } });
  assert.deepEqual(rows, []);
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/site-metadata/matches.json']);
});

test('the legacy API is used only when the Njalla snapshot request fails', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const rows = await loadWebsiteMatchFeed('https://feed.example', { now, fetchImpl: async url => {
    calls.push(url);
    return url.endsWith('/site-metadata/matches.json')
      ? new Response('', { status: 503 })
      : Response.json({ matches: [{ matchId: 'fallback', homeTeam: 'Home', awayTeam: 'Away',
        scheduledAt: '2026-11-13T20:00:00Z', status: 'FIXTURE' }] });
  } });
  assert.equal(rows[0].matchId, 'fallback');
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/site-metadata/matches.json', '/api/matches']);
});

