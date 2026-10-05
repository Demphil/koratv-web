import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPool, PoolError } from '../provider-pool.js';
import { createOperatorChannelPreparer } from '../operator-channel.js';

function setup(t, ids = ['A', 'B', 'D', 'F', 'G', 'H', 'I', 'J']) {
  const pool = new ProviderPool();
  t.after(() => pool.close());
  const accounts = Object.fromEntries(ids.map(id => [id, { enabled: true }]));
  const leases = ids.map(id => pool.acquire({ match_id: id, channel_id: `Old ${id}`, provider_sources: { [id]: `https://test.example/${id}.m3u8` } }, `prewarm:${id}`));
  return { pool, accounts, leases };
}

test('an occupied one-slot account probes exclusively, restores viewers and leaves peer media untouched', async t => {
  const { pool, leases } = setup(t);
  const original = leases[0], peer = leases[1];
  const demand = pool.demands.get(original.key);
  demand.viewers.set('real-viewer', Date.now());
  await pool.probe('A', 'New A', 'https://test.example/new.m3u8', async probe => {
    assert.equal(pool.valid(original), false);
    assert.equal(original.controller.signal.aborted, true);
    assert.equal(pool.valid(peer), true);
    pool.rebalance();
    await assert.rejects(pool.run(original, () => assert.fail('old media must not overlap')), PoolError);
    await pool.run(probe, () => Promise.resolve());
  });
  assert.equal(pool.probes.size, 0);
  const restored = pool.leases.get('A');
  assert.notEqual(restored.id, original.id);
  assert.equal(restored.url, original.url);
  assert.equal(pool.demands.get(restored.key).viewers.has('real-viewer'), true);
  assert.equal(pool.valid(peer), true);
});

test('failed replacement probing rolls back the original stream and releases the reservation', async t => {
  const { pool, leases } = setup(t);
  await assert.rejects(pool.probe('A', 'New', 'https://test.example/new.m3u8', async () => { throw new Error('probe failure'); }), /probe failure/);
  assert.equal(pool.probes.size, 0);
  assert.equal(pool.leases.get('A').url, leases[0].url);
  assert.ok(pool.valid(pool.leases.get('A')));
});

test('the operator can replace its match when all eight resources have viewers and retry an exact variant', async t => {
  const { pool, accounts, leases } = setup(t);
  const installs = [];
  const prepare = createOperatorChannelPreparer({ pool, accounts: () => accounts,
    discover: async (name, providers, verify) => {
      assert.deepEqual(providers, ['A']);
      assert.equal(await verify('A', { original_url: 'https://test.example/broken.m3u8' }, name), false);
      const url = 'https://test.example/working.m3u8';
      assert.equal(await verify('A', { original_url: url }, name), true);
      return { resolvedChannel: name, provider_sources: { A: url } };
    },
    warm: async (_, lease) => pool.run(lease, async () => ({ ok: lease.url.includes('working') })),
    install: async result => installs.push(result), refresh: () => {} });
  assert.deepEqual(await prepare('New A', () => {}, { matchId: 'A' }), { name: 'New A' });
  assert.equal(installs.length, 1);
  for (const peer of leases.slice(1)) assert.equal(pool.valid(peer), true);
});

test('a spare account tests the replacement without interrupting the current match', async t => {
  const { pool, accounts, leases } = setup(t, ['A']);
  accounts.B = { enabled: true };
  const prepare = createOperatorChannelPreparer({ pool, accounts: () => accounts,
    discover: async (name, providers, verify) => {
      assert.deepEqual(providers, ['B', 'A']);
      assert.equal(await verify('B', { original_url: 'https://test.example/new.m3u8' }, name), true);
      return { resolvedChannel: name, provider_sources: { B: 'https://test.example/new.m3u8' } };
    }, warm: async () => { assert.ok(pool.valid(leases[0])); return { ok: true }; },
    install: async () => {}, refresh: () => {} });
  await prepare('New', () => {}, { matchId: 'A' });
  assert.ok(pool.valid(leases[0]));
});

test('retesting the exact active stream requires no spare and does not interrupt viewers', async t => {
  const { pool, accounts, leases } = setup(t);
  const prepare = createOperatorChannelPreparer({ pool, accounts: () => accounts,
    discover: async (name, providers, verify) => {
      const url = leases[0].url;
      assert.equal(await verify('A', { original_url: url }, name), true);
      return { resolvedChannel: name, provider_sources: { A: url } };
    }, warm: async (_, lease) => { assert.equal(lease, leases[0]); return { ok: true }; }, install: async () => {}, refresh: () => {} });
  await prepare('Old A', () => {}, { matchId: 'A' });
  assert.ok(pool.valid(leases[0]));
});

test('a shared stream is not interrupted for a different match when no spare exists', async t => {
  const { pool, accounts, leases } = setup(t);
  pool.demands.get(leases[0].key).viewers.set('prewarm:other-match', Date.now());
  const prepare = createOperatorChannelPreparer({ pool, accounts: () => accounts, discover: async () => assert.fail('no discovery'), install: async () => {}, refresh: () => {} });
  await assert.rejects(prepare('New', () => {}, { matchId: 'A' }), /no_free_provider/);
  for (const lease of leases) assert.ok(pool.valid(lease));
});
