import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWebsiteMatchFeed, normalizeWebsiteMatch, parsePublicMatchSnapshot } from '../shared/public-match-feed.mjs';

test('fresh static snapshots become lightweight Kooora website cards', () => {
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
  assert.throws(() => parsePublicMatchSnapshot({ ...base, generatedAt: new Date(now - 31 * 60_000).toISOString() }, { now }), /stale/);
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

test('the static snapshot is the primary read and the legacy endpoint is only a fallback', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const sha = 'a'.repeat(40);
  const match = { id: 'kooora-1', match_id: 'kooora-1', source: 'kooora', active: true, home_team: 'Home', away_team: 'Away',
    league: 'الدوري الإنجليزي الممتاز', kickoff_time: '2026-11-13T20:00:00Z', payload: { status: 'FIXTURE' } };
  const feedUrl = 'https://raw.githubusercontent.com/Demphil/koratv-web/public-match-feed/site-metadata/matches.json';
  const rows = await loadWebsiteMatchFeed('https://stream-api.koratv.click/', { now, force: true, snapshotUrl: feedUrl, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    if (url === 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed') {
      return Response.json({ ref: 'refs/heads/public-match-feed', object: { sha, type: 'commit' } });
    }
    return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [match] });
  } });
  assert.equal(rows[0].matchId, 'kooora-1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[1][0], feedUrl.replace('/public-match-feed/', `/${sha}/`));
  assert.equal(calls[1][1].cache, 'no-store');
});

test('the public GitHub feed is independent from the website API origin', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const sha = 'b'.repeat(40);
  const feedUrl = 'https://raw.githubusercontent.com/Demphil/koratv-web/public-match-feed/site-metadata/matches.json';
  const rows = await loadWebsiteMatchFeed('https://stream-api.koratv.click', {
    snapshotUrl: feedUrl, now,
    fetchImpl: async url => {
      calls.push(url);
      if (url === 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed') {
        return Response.json({ ref: 'refs/heads/public-match-feed', object: { sha, type: 'commit' } });
      }
      return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [
        { id: 'central-feed', source: 'kooora', active: true, home_team: 'Home', away_team: 'Away',
          league: 'International Friendlies', kickoff_time: '2026-11-13T20:00:00Z', payload: {} },
      ] });
    },
  });
  assert.deepEqual(calls, ['https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed', feedUrl.replace('/public-match-feed/', `/${sha}/`)]);
  assert.equal(rows[0].matchId, 'central-feed');
});

test('a valid empty snapshot does not send avoidable traffic to the legacy API', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const sha = 'c'.repeat(40);
  const rows = await loadWebsiteMatchFeed('https://stream-api.koratv.click', { now, fetchImpl: async url => {
    calls.push(url);
    if (url === 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed') {
      return Response.json({ ref: 'refs/heads/public-match-feed', object: { sha, type: 'commit' } });
    }
    return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [] });
  } });
  assert.deepEqual(rows, []);
  assert.deepEqual(calls, ['https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed',
    `https://raw.githubusercontent.com/Demphil/koratv-web/${sha}/site-metadata/matches.json`]);
});

test('a resolved feed commit is reused for ten minutes within the page session', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const sha = 'd'.repeat(40);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url === 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed') {
      return Response.json({ ref: 'refs/heads/public-match-feed', object: { sha, type: 'commit' } });
    }
    return Response.json({ version: 1, generatedAt: new Date(now).toISOString(), matches: [] });
  };

  await loadWebsiteMatchFeed('https://stream-api.koratv.click', { now, fetchImpl });
  await loadWebsiteMatchFeed('https://stream-api.koratv.click', { now: now + 60_000, fetchImpl });
  assert.equal(calls.filter(url => url.includes('/git/ref/')).length, 1);
  assert.equal(calls.filter(url => url.includes(`/${sha}/site-metadata/`)).length, 2);
});

test('the legacy API is used only when the static snapshot request fails', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const calls = [];
  const rows = await loadWebsiteMatchFeed('https://stream-api.koratv.click', { now, fetchImpl: async url => {
    calls.push(url);
    if (url === 'https://api.github.com/repos/Demphil/koratv-web/git/ref/heads/public-match-feed') {
      return new Response('', { status: 503 });
    }
    return url.includes('/site-metadata/matches.json')
      ? new Response('', { status: 503 })
      : Response.json({ matches: [{ matchId: 'fallback', homeTeam: 'Home', awayTeam: 'Away',
        scheduledAt: '2026-11-13T20:00:00Z', status: 'FIXTURE' }] });
  } });
  assert.equal(rows[0].matchId, 'fallback');
  assert.deepEqual(calls.map(url => new URL(url).pathname), [
    '/repos/Demphil/koratv-web/git/ref/heads/public-match-feed', '/Demphil/koratv-web/public-match-feed/site-metadata/matches.json', '/api/matches',
  ]);
});

test('only the public raw GitHub feed URL is accepted', async () => {
  await assert.rejects(loadWebsiteMatchFeed('https://stream-api.koratv.click', {
    snapshotUrl: 'https://example.com/site-metadata/matches.json',
  }), /Invalid public GitHub match-feed URL/);
});

