import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPool } from '../provider-pool.js';
import { releaseStoppedMatchResources } from '../stop-match-resources.js';

test('stopping a match aborts its real viewers while preserving another supplier lease', t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const target = pool.acquire({ match_id:'target',channel_id:'Target TV',provider_sources:{A:'https://example.test/a.m3u8'} },'prewarm:target');
  pool.demands.get(target.key).viewers.set('real-viewer',Date.now());
  const peer = pool.acquire({ match_id:'peer',channel_id:'Peer TV',provider_sources:{B:'https://example.test/b.m3u8'} },'prewarm:peer');
  const keepalive = new Map([[target.key,'prewarm:target'],[peer.key,'prewarm:peer']]);
  releaseStoppedMatchResources(pool,['target'],[{matchId:'target',resolvedChannel:'Target TV'},{matchId:'peer',resolvedChannel:'Peer TV'}],keepalive);
  assert.equal(target.controller.signal.aborted,true);
  assert.equal(pool.demands.has(target.key),false);
  assert.equal(pool.leases.get('B'),peer);
  assert.equal(peer.controller.signal.aborted,false);
});

test('stopping one fixture on a shared channel keeps its peer heartbeat and media intact', t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const playback = { match_id:'target',channel_id:'Shared TV',provider_sources:{A:'https://example.test/a.m3u8'} };
  const shared = pool.acquire(playback,'prewarm:peer');
  pool.acquire(playback,'prewarm:target');
  const keepalive = new Map([[shared.key,'prewarm:target']]);
  releaseStoppedMatchResources(pool,['target'],[{matchId:'target',resolvedChannel:'Shared TV'},{matchId:'peer',resolvedChannel:'Shared TV'}],keepalive);
  assert.equal(pool.leases.get('A'),shared);
  assert.equal(shared.controller.signal.aborted,false);
  assert.equal(keepalive.get(shared.key),'prewarm:peer');
  assert.equal(pool.demands.get(shared.key).viewers.has('prewarm:target'),false);
  assert.equal(pool.touch(shared,keepalive.get(shared.key)),true);
});
