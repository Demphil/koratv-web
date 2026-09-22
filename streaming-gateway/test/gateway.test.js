import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

test('token lifecycle, IP checks and protected HLS resources', async (t) => {
  const store = new Map();
  const liveKickoff = new Date(Date.now() + 10 * 60_000).toISOString();
  const config = {
    secret: 'test-only-secret-with-at-least-32-bytes',
    hmacSecret: 'test-only-separate-hmac-secret-with-32-bytes',
    frontend: 'https://koratv.click', player: 'https://medic.cymru', api: 'https://api.example.com',
    trustedProxies: ['loopback'], sessionTtl: 7200,
    upstreamOrigins: new Set(['https://media.example.com']),
    getPlayback: async () => ({
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
    getMatches: async () => [{
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
      payload: { score: '2 - 1', goals: [{ player: 'Test Scorer', minute: 55, team: 'home' }] },
      source_ready: true, active: true, updated_at: '2026-09-20T10:00:00Z'
    }],
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
  const server = createApp({ config, redis, fetchImpl: async (url) => {
    fetchedPaths.push(url.pathname);
    if (url.pathname.endsWith('.m3u8')) {
      const response = new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nsegment.ts\n', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
      Object.defineProperty(response, 'url', { value: 'https://media.example.com/redirected/live/index.m3u8' });
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
  assert.equal((await request('/api/generate-token', 'https://bad.example', { channel: 'demo' })).status, 403);
  const entry = await (await request('/api/generate-token', config.frontend, { matchId: 'match-1' })).json();
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
  assert.equal((await request(`/api/stream.m3u8?quality=720p`, config.player, null, '203.0.113.1', { Authorization: `Bearer ${session.token}` })).status, 200);
  const claims = jwt.decode(session.token);
  delete claims.iat;
  claims.exp = Math.floor(Date.now() / 1000) - 1;
  const expired = jwt.sign(claims, config.secret, { algorithm: 'HS256' });
  assert.equal((await request(`/api/stream.m3u8?token=${expired}`, config.player)).status, 403);
  const playlist = await request(`/api/stream.m3u8?token=${session.token}`, config.player);
  assert.equal(playlist.status, 200);
  const content = await playlist.text();
  assert.ok(!content.includes('media.example.com'));
  assert.ok(!content.includes('token='));
  assert.ok(content.includes('URI="https://api.example.com/api/resource?resource='));
  const segment = new URL(content.trim().split('\n').at(-1));
  assert.equal((await request(segment.pathname + segment.search, config.player)).status, 403);
  assert.equal((await request(segment.pathname + segment.search, config.player, null, '203.0.113.1', { Authorization: `Bearer ${session.token}` })).status, 200);
  assert.ok(fetchedPaths.includes('/redirected/live/segment.ts'));
  config.getPlayback = async () => ({ is_streaming_active: false, reason: 'ended' });
  assert.equal((await request(`/api/stream.m3u8?token=${session.token}`, config.player)).status, 403);
  assert.equal((await request('/api/generate-token', config.frontend, { matchId: 'match-1' })).status, 409);
});
