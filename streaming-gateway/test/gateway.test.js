import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

test('token lifecycle, IP checks and protected HLS resources', async (t) => {
  const store = new Map();
  const matchInfoLookups = [];
  const liveKickoff = new Date(Date.now() + 10 * 60_000).toISOString();
  const config = {
    secret: 'test-only-secret-with-at-least-32-bytes',
    hmacSecret: 'test-only-separate-hmac-secret-with-32-bytes',
    frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: 'https://api.example.com',
    upstreamUserAgent: 'koratvProviderSync/1.0',
    frontendOrigins: new Set(['https://koratv.click']),
    trustedProxies: ['loopback'], sessionTtl: 7200,
    upstreamOrigins: new Set(['https://media.example.com']),
    sourceForOrigin: () => 'kooora',
    getPlaybackForSource: async () => ({
      is_streaming_active: true,
      match_id: 'match-1',
      channel_id: 'demo',
      stream_url: 'https://media.example.com/master.m3u8',
      qualities: [{ label: '1080p', height: 1080 }, { label: '720p', height: 720 }],
      quality_sources: [
        { label: '1080p', height: 1080, url: 'https://media.example.com/1080/master.m3u8' },
        { label: '720p', height: 720, url: 'https://media.example.com/720/master.m3u8' }
      ]
    }),
    getMatchesForOrigin: async (origin, matchId) => {
      if (matchId) matchInfoLookups.push({ origin, matchId });
      return [{
      id: 'match-1', match_id: 'match-1', home_team: 'Home', away_team: 'Away',
      league: 'الدوري الإسباني', kickoff_time: liveKickoff, channel: 'demo',
      payload: {
        homeLogo: 'https://images.example.com/home.png',
        awayLogo: 'https://images.example.com/away.png',
        streams: [{ url: 'https://media.example.com/leak.m3u8' }],
        original_url: 'https://media.example.com/leak.m3u8'
      },
      source_ready: true, active: true, updated_at: '2026-09-20T10:00:00Z'
    }, {
      id: 'match-lower', match_id: 'match-lower', home_team: 'Lower Home', away_team: 'Lower Away',
      league: 'الدوري الإيطالي الدرجة الثالثة', kickoff_time: '2026-09-20T13:00:00Z', channel: 'demo',
      payload: {}, active: true, updated_at: '2026-09-20T10:00:00Z'
    }, {
      id: 'match-botafogo', match_id: 'match-botafogo', home_team: 'Botafogo', away_team: 'MLS Away',
      league: 'Campeonato Brasileiro Série A', kickoff_time: liveKickoff, channel: 'demo',
      payload: {
        score: '2 - 1', goals: [{ player: 'Test Scorer', minute: 55, team: 'home' }],
        homeTeamId: 10, awayTeamId: 20,
        events: [{ elapsed: 55, player: 'Test Scorer', team: 'Botafogo', type: 'Goal', detail: 'Normal Goal' }],
        statistics: [{ team: { name: 'Botafogo' }, statistics: [{ type: 'Ball Possession', value: '58%' }] }],
        lineups: [{
          teamId: 10, team: 'Botafogo', formation: '4-3-3', coach: 'Coach',
          startXI: [
            { id: 1, name: 'Player One', number: 9, position: 'F', grid: '1:1', photo: 'https://media.api-sports.io/football/players/1.png' },
            { id: 2, name: 'Untrusted Photo', photo: 'https://bad.example/photo.png' }
          ],
          substitutes: []
        }],
        standingsVersion: 2,
        standings: [{ rank: 1, team: 'Botafogo', points: 42 }],
        venue: 'Test Stadium', referee: 'Test Referee'
      },
      source_ready: true, active: true, updated_at: '2026-09-20T10:00:00Z'
    }, ...[-1, 2].map((offset) => ({
      id: `out-of-window-${offset}`, match_id: `out-of-window-${offset}`,
      home_team: `Old home ${offset}`, away_team: `Old away ${offset}`,
      league: 'الدوري الإسباني',
      kickoff_time: new Date(Date.now() + offset * 86400000).toISOString(),
      payload: { isFinished: true }, active: true,
    }))];
    },
  };
  const redis = {
    incr: async () => 1, expire: async () => 1,
    ping: async () => 'PONG',
    set: async (key, value, options = {}) => {
      if (options.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    get: async (key) => store.get(key) || null,
  };
  const fetchedPaths = [];
  const fetchedUrls = [];
  const fetchedUserAgents = [];
  const server = createApp({ config, redis, fetchImpl: async (url, options) => {
    fetchedUrls.push(String(url));
    fetchedPaths.push(url.pathname);
    fetchedUserAgents.push(options.headers['User-Agent']);
    if (url.pathname.endsWith('.m3u8')) {
      const isMaster = url.pathname.endsWith('/master.m3u8');
      const body = isMaster
        ? '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="master.key"\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant/index.m3u8\n'
        : '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nsegment.ts\n';
      const response = new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
      Object.defineProperty(response, 'url', { value: isMaster ? 'https://media.example.com/redirected/live/master.m3u8' : 'https://media.example.com/redirected/live/index.m3u8' });
      return response;
    }
    return new Response(new Uint8Array([71, 0, 1]), { headers: { 'Content-Type': 'video/mp2t' } });
  } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, origin, body, ip = '203.0.113.1', extraHeaders = {}) => fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': 'Browser test', ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await request('/healthz', config.player)).status, 200);
  // The player document must survive a normal browser reload; stream APIs stay token protected below.
  assert.equal((await fetch(base + '/739184.html', { headers: { 'User-Agent': 'Browser test' } })).status, 200);
  assert.equal((await fetch(base + '/739184.html', { headers: { Referer: `${config.frontend}/`, 'User-Agent': 'Browser test' } })).status, 200);
  assert.equal((await request('/api/matches', config.frontend, null, '203.0.113.1', { 'User-Agent': 'Googlebot/2.1' })).status, 200);
  assert.equal((await request('/api/matches', config.frontend, null, '203.0.113.1', { 'User-Agent': 'UnknownBot/1.0' })).status, 403);
  const matchesResponse = await request('/api/matches', config.frontend);
  assert.equal(matchesResponse.status, 200);
  assert.equal(matchesResponse.headers.get('access-control-allow-origin'), config.frontend);
  const matchesBody = await matchesResponse.json();
  assert.deepEqual(matchesBody.matches.map(({ matchId, homeTeam, awayTeam }) => ({ matchId, homeTeam, awayTeam })), [
    { matchId: 'match-1', homeTeam: 'Home', awayTeam: 'Away' },
    { matchId: 'match-botafogo', homeTeam: 'Botafogo', awayTeam: 'MLS Away' }
  ]);
  assert.deepEqual(matchesBody.matches[0].streams, []);
  assert.equal(matchesBody.matches[0].original_url, undefined);
  assert.equal(matchesBody.matches[0].channel, undefined);
  assert.equal(matchesBody.matches[0].sourceReady, true);
  const infoResponse = await request('/api/match-info?matchId=match-botafogo', config.player);
  assert.equal(infoResponse.status, 200);
  const infoBody = await infoResponse.json();
  assert.equal(infoBody.match.goals[0].player, 'Test Scorer');
  assert.equal(infoBody.match.matchId, 'match-botafogo');
  assert.equal(matchInfoLookups.at(-1).matchId, 'match-botafogo');
  assert.equal(infoBody.match.channelName, 'demo');
  assert.equal(infoBody.match.homeTeamId, 10);
  assert.equal(infoBody.match.events[0].elapsed, 55);
  assert.equal(infoBody.match.lineups[0].startXI[0].photo, 'https://media.api-sports.io/football/players/1.png');
  assert.equal(infoBody.match.lineups[0].startXI[1].photo, '');
  assert.equal(infoBody.match.standings[0].team, 'Botafogo');
  assert.equal(infoBody.match.venue, 'Test Stadium');
  assert.equal((await request('/api/generate-token', 'https://bad.example', { channel: 'demo' })).status, 403);
  const entry = await (await request('/api/generate-token', config.frontend, { matchId: 'match-1' })).json();
  assert.equal((await request('/api/generate-token', config.frontend, { matchId: 'different-match' })).status, 409);
  assert.equal((await request('/api/generate-token', config.player, { matchId: 'match-1' })).status, 200);
  assert.equal(entry.expiresIn, 300);
  assert.equal(jwt.decode(entry.token).stream_url, undefined);
  assert.equal((await request('/api/redeem-token', config.player, { token: entry.token }, '203.0.113.2')).status, 403);
  const session = await (await request('/api/redeem-token', config.player, { token: entry.token })).json();
  assert.equal(session.expiresIn, 7200);
  assert.deepEqual(session.qualities.map((quality) => quality.label), ['1080p', '720p']);
  assert.equal(JSON.stringify(session).includes('media.example.com'), false);
  assert.equal(jwt.decode(session.token).stream_url, undefined);
  assert.equal((await request('/api/redeem-token', config.player, { token: entry.token })).status, 403);
  assert.equal((await request(`/api/stream.m3u8?token=${entry.token}`, config.player)).status, 403);
  assert.equal((await request('/api/stream.m3u8?token=invalid', config.player)).status, 403);
  assert.equal((await request(`/api/stream.m3u8?token=${session.token}`, config.player, null, '203.0.113.2')).status, 403);
  const noReferrerStream = await fetch(`${base}/api/stream.m3u8?quality=720p`, {
    headers: { Authorization: `Bearer ${session.token}`, 'User-Agent': 'Browser test', 'X-Forwarded-For': '203.0.113.1' }
  });
  assert.equal(noReferrerStream.status, 200);
  const foreignOriginStream = await fetch(`${base}/api/stream.m3u8?quality=720p`, {
    headers: { Origin: 'https://bad.example', Authorization: `Bearer ${session.token}`, 'User-Agent': 'Browser test', 'X-Forwarded-For': '203.0.113.1' }
  });
  assert.equal(foreignOriginStream.status, 403);
  const browserStyleStream = await fetch(`${base}/api/stream.m3u8?quality=720p`, {
    headers: { Referer: `${config.player}/739184.html`, Authorization: `Bearer ${session.token}`, 'User-Agent': 'Browser test', 'X-Forwarded-For': '203.0.113.1' }
  });
  assert.equal(browserStyleStream.status, 200);
  assert.ok(fetchedUrls.includes('https://media.example.com/720/master.m3u8'));
  const claims = jwt.decode(session.token);
  delete claims.iat;
  claims.exp = Math.floor(Date.now() / 1000) - 1;
  const expired = jwt.sign(claims, config.secret, { algorithm: 'HS256' });
  assert.equal((await request(`/api/stream.m3u8?token=${expired}`, config.player)).status, 403);
  const playlist = await request(`/api/stream.m3u8?token=${session.token}`, config.player);
  assert.equal(playlist.status, 200);
  assert.ok(fetchedUserAgents.length > 0);
  assert.ok(fetchedUserAgents.every((userAgent) => userAgent === config.upstreamUserAgent));
  const content = await playlist.text();
  assert.ok(!content.includes('media.example.com'));
  assert.ok(content.includes('URI="https://api.example.com/api/resource?resource='));
  assert.ok(content.includes('token='));
  const childPlaylistUrl = new URL(content.trim().split('\n').at(-1));
  const childPlaylistResponse = await request(childPlaylistUrl.pathname + childPlaylistUrl.search, config.player);
  assert.equal(childPlaylistResponse.status, 200);
  const childPlaylist = await childPlaylistResponse.text();
  assert.ok(childPlaylist.startsWith('#EXTM3U'));
  assert.ok(childPlaylist.includes('api.example.com/api/resource?resource='));
  const segment = new URL(childPlaylist.trim().split('\n').at(-1));
  const segmentResponses = await Promise.all([
    request(segment.pathname + segment.search, config.player, null, '203.0.113.1'),
    request(segment.pathname + segment.search, config.player, null, '203.0.113.1', { Authorization: `Bearer ${session.token}` })
  ]);
  assert.deepEqual(segmentResponses.map((response) => response.status), [200, 200]);
  await Promise.all(segmentResponses.map((response) => response.arrayBuffer()));
  assert.ok(fetchedPaths.includes('/redirected/live/segment.ts'));
  assert.equal(fetchedPaths.filter((path) => path === '/redirected/live/segment.ts').length, 1);
  const originalApi = config.api;
  config.api = config.player;
  const recoveredPlaylist = await request(`/api/stream.m3u8?token=${session.token}`, config.player, null, '203.0.113.1', {
    'X-Forwarded-Host': 'stream-api.koratv.click',
    'X-Forwarded-Proto': 'https'
  });
  assert.equal(recoveredPlaylist.status, 200);
  const recoveredContent = await recoveredPlaylist.text();
  assert.ok(recoveredContent.includes('https://stream-api.koratv.click/api/resource?resource='));
  assert.ok(!recoveredContent.includes('https://fabor.sbs/api/resource?resource='));
  config.api = originalApi;
  const health = await (await request('/healthz', config.player)).json();
  assert.ok(health.hlsCache.bytes > 0);
  assert.ok(health.hlsCache.prefetched > 0);
  config.getPlaybackForSource = async () => ({
    is_streaming_active: false,
    reason: 'source_unavailable',
    diagnostics: {
      stage: 'provider_catalog',
      requestedChannels: ['SABC Plus'],
      attempts: [{ requestedName: 'SABC Plus', channelTableName: null, catalogName: 'SABC Plus', providerCount: 0 }]
    }
  });
  assert.equal((await request(`/api/stream.m3u8?token=${session.token}`, config.player)).status, 403);
  const unavailable = await request('/api/generate-token', config.frontend, { matchId: 'match-1' });
  assert.equal(unavailable.status, 409);
  const unavailableBody = await unavailable.json();
  assert.equal(unavailableBody.error, 'source_unavailable');
  assert.deepEqual(unavailableBody.diagnostics.requestedChannels, ['SABC Plus']);
  assert.equal(unavailableBody.diagnostics.attempts[0].providerCount, 0);
});

test('token generation refreshes the provider catalog once on source_unavailable', async (t) => {
  let refreshes = 0;
  const calls = [];
  const config = {
    secret: 'test-only-secret-with-at-least-32-bytes',
    hmacSecret: 'test-only-separate-hmac-secret-with-32',
    frontend: 'https://koratv.click',
    frontendOrigins: new Set(['https://koratv.click']),
    player: 'https://fabor.sbs',
    api: 'https://api.example.com',
    trustedProxies: ['loopback'],
    upstreamOrigins: new Set(),
    upstreamUserAgent: 'koratvProviderSync/1.0',
    sessionTtl: 7200,
    sourceForOrigin: () => 'kooora',
    refreshProviderCatalog: () => { refreshes += 1; },
    getPlaybackForSource: async (source, matchId, options = {}) => {
      calls.push({ source, matchId, fresh: options.fresh === true });
      return options.fresh ? {
        is_streaming_active: true,
        match_id: matchId,
        channel_id: 'SABC+ HD',
        stream_url: 'https://media.example.com/sabc.m3u8',
      } : {
        is_streaming_active: false,
        reason: 'source_unavailable',
        diagnostics: { stage: 'provider_catalog', requestedChannels: ['SABC Plus'], attempts: [] }
      };
    },
    getMatchesForOrigin: async () => [],
  };
  const redis = { incr: async () => 1, expire: async () => 1, ping: async () => 'PONG', set: async () => 'OK', get: async () => null };
  const server = createApp({ config, redis, fetchImpl: fetch }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/generate-token`, {
    method: 'POST',
    headers: { Origin: config.frontend, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1', 'User-Agent': 'Browser test' },
    body: JSON.stringify({ matchId: 'match-1' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.channelName, 'SABC+ HD');
  assert.equal(refreshes, 1);
  assert.deepEqual(calls.map((call) => call.fresh), [false, true]);
  assert.equal(jwt.decode(body.token).channel, 'SABC+ HD');
});
