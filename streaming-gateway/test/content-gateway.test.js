import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { publicMatchId } from '../../shared/public-match-id.mjs';

test('passive content OCR reuses HLS bytes, does not block prewarm, and gates only a proven-wrong new session', async t => {
  const kickoff = new Date(Date.now() - 20 * 60_000).toISOString();
  const fixtures = [{ match_id: 'target', home_team: 'Venezia', away_team: 'Inter', channel: 'Target TV', resource_status: 'ASSIGNED' },
    { match_id: 'peer', home_team: 'Monza', away_team: 'Napoli', channel: 'Peer TV', resource_status: 'ASSIGNED' }]
    .map(row => ({ ...row, kickoff_time: kickoff, source: 'kooora', league: 'Serie A', payload: { status: 'LIVE' } }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const config = { providerPoolEnabled: true, prewarmAssignedResources: true, contentVerificationEnabled: true, mediaValidationEnabled: false,
    secret: 'test-secret-longer-than-thirty-two-characters', hmacSecret: 'test-independent-hmac-longer-than-thirty-two',
    frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: 'https://api.example', sessionTtl: 300,
    frontendOrigins: new Set(['https://koratv.click']), upstreamOrigins: new Set(), trustedProxies: [],
    sourceForOrigin: () => 'kooora', getMatchesForOrigin: async () => fixtures,
    providerAssignments: () => ({ assignments: fixtures.map((row, i) => ({ matchId: row.match_id, providerId: i ? 'B' : 'A', resolvedChannel: row.channel })) }),
    getPlaybackForSource: async (_, id) => ({ is_streaming_active: true, match_id: id, channel_id: id === 'target' ? 'Target TV' : 'Peer TV',
      stream_url: `https://test.example/${id}.m3u8`, provider_sources: { [id === 'target' ? 'A' : 'B']: `https://test.example/${id}.m3u8` } }),
    inspectContent: async bytes => { assert.equal(bytes.byteLength, 3); await gate;
      const row = '20:10 MON 0-0 NAP'.split(' ').map(text => ({ text, confidence: 95 })); return [row, row]; } };
  const redis = { ping: async () => 'PONG', incr: async () => 1, expire: async () => 1, set: async () => 'OK', get: async () => null };
  const app = createApp({ config, redis, fetchImpl: async url => {
    calls.push(url.href);
    const response = new Response(url.pathname.endsWith('.m3u8') ? '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:2\n#EXTINF:6,\nsegment.ts\n' : new Uint8Array([71, 0, 1]));
    Object.defineProperty(response, 'url', { value: url.href }); return response;
  } });
  clearInterval(app.locals.providerPrewarmTimer); clearInterval(app.locals.providerPrewarmHeartbeatTimer); clearTimeout(app.locals.providerPrewarmStartupTimer);
  t.after(() => { release(); app.locals.providerPool.close(); });
  const result = await app.locals.prewarmAssignedResources('test');
  assert.equal(result.warmed, 2);
  const peer = app.locals.providerPool.leases.get('B');
  const existingTarget = app.locals.providerPool.leases.get('A');
  app.locals.providerPool.touch(peer, 'real-peer-viewer');
  release(); await app.locals.matchContentVerifier.idle();
  assert.equal(calls.length, 4, 'OCR must not open any additional provider URL');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const matches = (await (await fetch(base + '/api/matches', { headers: { Origin: config.frontend } })).json()).matches;
  const target = matches.find(row => row.homeTeam === 'Venezia'), good = matches.find(row => row.homeTeam === 'Monza');
  assert.equal(target.contentVerification.status, 'mismatch'); assert.equal(target.sourceReady, false);
  assert.equal(good.contentVerification.status, 'verified'); assert.equal(good.sourceReady, true);
  const entry = id => fetch(base + '/api/generate-token', { method: 'POST', headers: { Origin: config.player, 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId: publicMatchId(id) }) });
  assert.equal((await entry('target')).status, 409);
  assert.equal((await entry('peer')).status, 200);
  assert.equal(peer.controller.signal.aborted, false); assert.equal(app.locals.providerPool.leases.get('B'), peer);
  assert.equal(existingTarget.controller.signal.aborted, false, 'content checks never abort an existing viewer to inspect alternatives');
});
