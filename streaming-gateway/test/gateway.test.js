import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

test('token lifecycle, IP checks and protected HLS resources', async (t) => {
  const used = new Set();
  const config = {
    secret: 'test-only-secret-with-at-least-32-bytes',
    hmacSecret: 'test-only-separate-hmac-secret-with-32-bytes',
    frontend: 'https://koratv.click', player: 'https://medic.cymru', api: 'https://api.example.com',
    trustedProxies: ['loopback'], streams: { demo: 'https://media.example.com/master.m3u8' },
    upstreamOrigins: new Set(['https://media.example.com']),
    getStreamingConfig: async () => ({ is_streaming_active: true }),
    getMatches: async () => [{
      id: 'match-1', match_id: 'match-1', home_team: 'Home', away_team: 'Away',
      league: 'League', kickoff_time: '2026-09-20T12:00:00Z', channel: 'demo',
      payload: { homeLogo: 'https://images.example.com/home.png', awayLogo: 'https://images.example.com/away.png' },
      active: true, updated_at: '2026-09-20T10:00:00Z'
    }],
  };
  const redis = {
    incr: async () => 1, expire: async () => 1,
    ping: async () => 'PONG',
    set: async (key) => { if (used.has(key)) return null; used.add(key); return 'OK'; },
  };
  const server = createApp({ config, redis, fetchImpl: async (url) => {
    if (url.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nsegment.ts\n', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    return new Response(new Uint8Array([71, 0, 1]), { headers: { 'Content-Type': 'video/mp2t' } });
  } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, origin, body, ip = '203.0.113.1') => fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': 'Browser test' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await request('/healthz', config.player)).status, 200);
  const matchesResponse = await request('/api/matches', config.frontend);
  assert.equal(matchesResponse.status, 200);
  assert.equal(matchesResponse.headers.get('access-control-allow-origin'), config.frontend);
  assert.deepEqual((await matchesResponse.json()).matches.map(({ matchId, homeTeam, awayTeam }) => ({ matchId, homeTeam, awayTeam })), [
    { matchId: 'match-1', homeTeam: 'Home', awayTeam: 'Away' }
  ]);
  assert.equal((await request('/api/generate-token', 'https://bad.example', { channel: 'demo' })).status, 403);
  const entry = await (await request('/api/generate-token', config.frontend, { channel: 'demo' })).json();
  assert.equal((await request('/api/redeem-token', config.player, { token: entry.token }, '203.0.113.2')).status, 403);
  const session = await (await request('/api/redeem-token', config.player, { token: entry.token })).json();
  assert.equal((await request('/api/redeem-token', config.player, { token: entry.token })).status, 403);
  assert.equal((await request(`/api/stream.m3u8?token=${entry.token}`, config.player)).status, 403);
  assert.equal((await request('/api/stream.m3u8?token=invalid', config.player)).status, 403);
  assert.equal((await request(`/api/stream.m3u8?token=${session.token}`, config.player, null, '203.0.113.2')).status, 403);
  const claims = jwt.decode(session.token);
  delete claims.iat;
  claims.exp = Math.floor(Date.now() / 1000) - 1;
  const expired = jwt.sign(claims, config.secret, { algorithm: 'HS256' });
  assert.equal((await request(`/api/stream.m3u8?token=${expired}`, config.player)).status, 403);
  const playlist = await request(`/api/stream.m3u8?token=${session.token}`, config.player);
  assert.equal(playlist.status, 200);
  const content = await playlist.text();
  assert.ok(!content.includes('media.example.com'));
  const segment = new URL(content.trim().split('\n').at(-1));
  assert.equal((await request(segment.pathname + segment.search, config.player)).status, 200);
  assert.ok(content.includes('URI="https://api.example.com/api/resource?token='));
  config.getStreamingConfig = async () => ({ is_streaming_active: false });
  assert.equal((await request(`/api/stream.m3u8?token=${session.token}`, config.player)).status, 403);
  assert.equal((await request('/api/generate-token', config.frontend, { channel: 'demo' })).status, 403);
});
