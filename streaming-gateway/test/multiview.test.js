import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { PROVIDER_IDS } from '../provider-pool.js';
import { MULTIVIEW_CHANNELS } from '../multiview.js';

test('private six-screen test shares the production pool and never exposes provider URLs', async t => {
  const store = new Map(); let requests = 0;
  const sources = channel => Object.fromEntries(PROVIDER_IDS.map(id => [id, `https://${id.toLowerCase()}.example/live/user/private-password/${channel.replaceAll(' ', '-')}.m3u8`]));
  const config = { providerPoolEnabled: true, enableAntiBot: false, secret: 'private-test-secret-longer-than-32', hmacSecret: 'private-test-hmac-longer-than-32',
    trustedProxies: [], frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: 'https://fabor.sbs', upstreamOrigins: new Set(),
    providerAccounts: () => Object.fromEntries(PROVIDER_IDS.map(id => [id, { enabled: true, id: `Account_${id}` }])),
    providerChannels: () => Object.fromEntries(MULTIVIEW_CHANNELS.map(channel => [channel, sources(channel)])) };
  const redis = { ping: async () => 'PONG', set: async (key,value) => { store.set(key,value); return 'OK'; }, get: async key => store.get(key) };
  const app = createApp({ config, redis, fetchImpl: async url => { requests++; return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:12\n#EXTINF:6,\n12.ts\n', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { app.locals.providerPool.close(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const access = jwt.sign({}, config.secret, { issuer:'koratv-gateway', audience:'multiview-admin', expiresIn:60 });
  const headers = { Origin:config.player, Authorization:`Bearer ${access}` };
  assert.equal((await fetch(`${base}/api/multiview/session`, {method:'POST'})).status,401);
  const session = await (await fetch(`${base}/api/multiview/session`, {method:'POST',headers})).json();
  assert.equal(session.screens.length,6); assert.equal(requests,0);
  assert.doesNotMatch(JSON.stringify(session), /private-password|\.example/);
  const responses = await Promise.all(session.screens.map(s => fetch(`${base}/api/stream.m3u8?token=${s.token}`, {headers:{Origin:config.player}})));
  assert.ok(responses.every(r=>r.status===200));
  assert.equal(app.locals.providerPool.leases.size,6);
  const screen = session.screens[0];
  const claims = jwt.decode(screen.token);
  const original = app.locals.providerPool.leases.get('A');
  const reused = app.locals.providerPool.acquire({match_id:'real-match',pool_key:'real-match',channel_id:screen.channel,provider_sources:sources(screen.channel),priority_score:100},'real-viewer');
  assert.equal(reused.id,original.id);
  const status = await (await fetch(`${base}/api/multiview/status`,{headers})).json();
  assert.equal(status.screens[0].account,'Account_A');
  assert.equal(status.screens[0].sequence,12);
  assert.doesNotMatch(JSON.stringify(status),/private-password|\.example/);
  assert.equal(claims.diagnostic,true);
});
