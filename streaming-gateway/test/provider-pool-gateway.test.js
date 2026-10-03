import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createHmac } from 'node:crypto';

test('pool gateway coalesces viewers, ignores quality overrides, fences old resources, and preserves the second account on upstream failures', async t => {
  const store = new Map(); const calls = [];
  let rejectA = false, throwA = false, throwSegmentA = false, includeC = false;
  const config = {
    providerPoolEnabled: true, enableAntiBot: false,
    secret: 'test-pool-secret-longer-than-32-characters', hmacSecret: 'test-pool-hmac-independent-longer-than-32',
    frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: 'https://api.example',
    frontendOrigins: new Set(['https://koratv.click']), upstreamOrigins: new Set(), trustedProxies: [],
    sessionTtl: 300, sourceForOrigin: () => 'kooora', upstreamUserAgent: 'test',
    getPlaybackForSource: async (_, id) => ({ is_streaming_active: true, match_id: id, pool_key: id, channel_id: id,
      priority_score: id === 'low' ? 10 : 100, stream_url: `https://a.example/${id}/main.m3u8`,
      provider_sources: { A: `https://a.example/${id}/main.m3u8`, B: `https://b.example/${id}/main.m3u8`, ...(includeC ? { C: `https://c.example/${id}/main.m3u8` } : {}) },
      qualities: [{ label: '1080p', height: 1080 }], quality_sources: [{ label: '1080p', url: 'https://other.example/bad.m3u8' }] }),
  };
  const redis = { ping: async () => 'PONG', incr: async () => 1, expire: async () => 1,
    set: async (key, value, options = {}) => { if (options.NX && store.has(key)) return null; store.set(key, value); return 'OK'; },
    get: async key => store.get(key) };
  const app = createApp({ config, redis, fetchImpl: async url => {
    calls.push(url.href);
    if (throwA && url.hostname === 'a.example') throw new Error('fetch failed');
    if (throwSegmentA && !url.pathname.endsWith('.m3u8')) throw new Error('segment fetch failed');
    if (rejectA && url.hostname === 'a.example') return new Response('', { status: 403 });
    const response = new Response(url.pathname.endsWith('.m3u8') ? '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6,\none.ts\n' : new Uint8Array([71,0,1]),
      { headers: { 'Content-Type': url.pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' } });
    Object.defineProperty(response, 'url', { value: url.href }); return response;
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { app.locals.providerPool.close(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
    Origin: config.player, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const session = async id => {
    const ticket = await (await request('/api/generate-token', '', { matchId: id })).json();
    const response = await (await request('/api/redeem-token', '', { token: ticket.token })).json();
    assert.deepEqual(response.qualities, []); assert.equal(response.singleQuality, true); return response.token;
  };
  const a1 = await session('a'), a2 = await session('a'), b = await session('b'), low = await session('low');
  const roots = await Promise.all([request('/api/stream.m3u8?quality=1080p', a1), request('/api/stream.m3u8?quality=720p', a2)]);
  assert.deepEqual(roots.map(r => r.status), [200, 200]);
  assert.equal(calls.filter(url => url.endsWith('/a/main.m3u8')).length, 1);
  const resource = new URL((await roots[0].text()).split('\n').find(line => line.startsWith('https:')));
  assert.equal((await request(resource.pathname + resource.search, a1)).status, 200);
  assert.equal((await request('/api/stream.m3u8', b)).status, 200);
  assert.equal((await request('/api/stream.m3u8', low)).status, 503);
  assert.equal(calls.some(url => /other.example|\/low\//.test(url)), false);
  const aLease = [...app.locals.providerPool.leases.values()].find(lease => lease.key === 'a');
  rejectA = true; app.locals.providerPool.fail(aLease);
  assert.equal((await request(resource.pathname + resource.search, a1)).status, 503);
  assert.equal((await request('/api/stream.m3u8', b)).status, 200);
  assert.equal(app.locals.providerPool.snapshot().find(row => row.provider === 'B').channel, 'b');
  app.locals.providerPool.revoke('B');
  app.locals.providerPool.demands.clear(); app.locals.providerPool.blocked.clear();
  const fresh = await session('fresh');
  assert.equal((await request('/api/stream.m3u8', fresh)).status, 200);
  assert.ok(calls.includes('https://a.example/fresh/main.m3u8'));
  assert.ok(calls.includes('https://b.example/fresh/main.m3u8'));
  assert.equal(app.locals.providerPool.snapshot()[0].provider, 'B');
  for (const provider of ['A','B','C']) app.locals.providerPool.revoke(provider);
  app.locals.providerPool.demands.clear(); app.locals.providerPool.blocked.clear();
  calls.length = 0; rejectA = false; throwA = true;
  const network = await session('network');
  assert.equal((await request('/api/stream.m3u8', network)).status, 200);
  assert.ok(calls.includes('https://a.example/network/main.m3u8'));
  assert.ok(calls.includes('https://b.example/network/main.m3u8'));
  assert.equal(app.locals.providerPool.snapshot()[0].provider, 'B');
  throwA = false;
  for (const provider of ['A','B','C']) app.locals.providerPool.revoke(provider);
  app.locals.providerPool.demands.clear(); app.locals.providerPool.blocked.clear();
  calls.length = 0; throwSegmentA = true;
  const segmentToken = await session('segment-network');
  const segmentManifest = await request('/api/stream.m3u8', segmentToken);
  assert.equal(segmentManifest.status, 200);
  const segmentResource = new URL((await segmentManifest.text()).split('\n').find(line => line.startsWith('https:')));
  assert.equal((await request(segmentResource.pathname + segmentResource.search, segmentToken)).status, 409);
  throwSegmentA = false;
  for (const provider of ['A','B','C']) app.locals.providerPool.revoke(provider);
  app.locals.providerPool.demands.clear(); app.locals.providerPool.blocked.clear();
  rejectA = false; includeC = true;
  const three = await Promise.all(['three-a','three-b','three-c'].map(session));
  const responses = await Promise.all(three.map(token => request('/api/stream.m3u8', token)));
  assert.deepEqual(responses.map(r => r.status), [200,200,200]);
  assert.deepEqual(app.locals.providerPool.snapshot().map(row => row.provider).sort(), ['A','B','C']);
  for (let i=0; i<responses.length; i++) {
    const segment = new URL((await responses[i].text()).split('\n').find(line => line.startsWith('https:')));
    assert.equal((await request(segment.pathname + segment.search, three[i])).status, 200);
  }
  assert.equal((await request('/api/stream.m3u8', low)).status, 503);
  for (const provider of ['A','B','C','D','E','F']) app.locals.providerPool.revoke(provider);
  app.locals.providerPool.demands.clear(); app.locals.providerPool.blocked.clear();
  config.providerChannels = () => Object.fromEntries([1,2,3,4,5,6].map(n => [`beIN SPORTS HD ${n}`,
    Object.fromEntries(['A','B','C','D','E','F'].map(p => [p, `https://${p.toLowerCase()}.example/${n}/main.m3u8`]))]));
  const admin = createHmac('sha256', config.hmacSecret).update('koratv-account-admin-v1').digest('hex');
  assert.equal((await request('/internal/accounts-probe', '', {})).status, 404);
  assert.equal((await fetch(base + '/internal/accounts-status', { headers: { Authorization: `Bearer ${admin}`, 'X-Forwarded-For': '203.0.113.5' } })).status, 404);
  const six = await (await request('/internal/accounts-probe', admin, {})).json();
  assert.equal(six.results.length, 6);
  assert.equal(new Set(six.results.map(r => r.channel)).size, 6);
  assert.ok(six.results.every(r => r.manifestStatus === 200 && r.segmentStatus === 200 && r.bytes > 0));
});

test('provider prewarm leases assigned resources before the first viewer', async t => {
  const calls = [];
  const config = {
    providerPoolEnabled: true,
    prewarmAssignedResources: true,
    prewarmIntervalMs: 60_000,
    prewarmMaxResources: 8,
    enableAntiBot: false,
    secret: 'test-pool-secret-longer-than-32-characters',
    hmacSecret: 'test-pool-hmac-independent-longer-than-32',
    frontend: 'https://koratv.click',
    player: 'https://fabor.sbs',
    api: 'https://api.example',
    frontendOrigins: new Set(['https://koratv.click']),
    upstreamOrigins: new Set(),
    trustedProxies: [],
    sessionTtl: 300,
    sourceForOrigin: () => 'kooora',
    upstreamUserAgent: 'test',
    providerAssignments: () => ({
      assignments: [{ matchId: 'assigned-live', providerId: 'A', resolvedChannel: 'beIN SPORTS HD 1' }],
      ignored: []
    }),
    getPlaybackForSource: async (_, id) => ({
      is_streaming_active: true,
      match_id: id,
      pool_key: id,
      channel_id: 'beIN SPORTS HD 1',
      priority_score: 100,
      stream_url: `https://a.example/${id}/main.m3u8`,
      provider_sources: { A: `https://a.example/${id}/main.m3u8` }
    }),
  };
  const redis = {
    ping: async () => 'PONG',
    incr: async () => 1,
    expire: async () => 1,
    set: async () => 'OK',
    get: async () => null
  };
  const app = createApp({ config, redis, fetchImpl: async url => {
    calls.push(url.href);
    const isManifest = url.pathname.endsWith('.m3u8');
    const response = new Response(isManifest ? '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:6,\nseg7.ts\n' : new Uint8Array([71, 0, 1]),
      { headers: { 'Content-Type': isManifest ? 'application/vnd.apple.mpegurl' : 'video/mp2t' } });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  } });
  clearInterval(app.locals.providerPrewarmTimer);
  clearTimeout(app.locals.providerPrewarmStartupTimer);
  t.after(() => app.locals.providerPool.close());

  const state = await app.locals.prewarmAssignedResources('test', { fresh: true });
  assert.equal(state.warmed, 1);
  assert.equal(state.failed, 0);
  assert.ok(calls.includes('https://a.example/assigned-live/main.m3u8'));
  assert.deepEqual(app.locals.providerPool.snapshot().map((item) => [item.provider, item.channel]), [['A', 'beIN SPORTS HD 1']]);
});
