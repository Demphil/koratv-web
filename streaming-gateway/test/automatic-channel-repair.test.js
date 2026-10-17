import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPool, PROVIDER_IDS } from '../provider-pool.js';
import { createAutomaticChannelRepair } from '../automatic-channel-repair.js';

for (const provider of PROVIDER_IDS) {
  test(`automatic edition repair validates media on provider ${provider} without borrowing a peer`, async t => {
    const pool = new ProviderPool(); t.after(() => pool.close());
    const peerId = PROVIDER_IDS.find(id => id !== provider);
    const playback = { match_id: 'target', channel_id: 'Exact HD 5', preferred_provider: provider,
      provider_sources: { [provider]: 'https://test.example/bad.m3u8' } };
    const bad = pool.acquire(playback, 'prewarm:target');
    const peer = pool.acquire({ match_id: 'peer', channel_id: 'Other TV', provider_sources: { [peerId]: 'https://test.example/peer.m3u8' } }, 'prewarm:peer');
    pool.demands.get(bad.key).viewers.set('prewarm:shared', Date.now());
    const tested = [], installed = [];
    const repair = createAutomaticChannelRepair({ pool,
      discover: async (channel, ids, verify) => {
        assert.deepEqual(ids, [provider]);
        for (const edition of ['bad', 'hevc', 'working']) {
          const candidate = { source_name: `Exact HD 5 ${edition}`, original_url: `https://test.example/${edition}.m3u8` };
          if (await verify(provider, candidate, channel)) return { resolvedChannel: channel, provider_sources: { [provider]: candidate.original_url } };
        }
      },
      warm: async (_playback, lease) => {
        assert.equal(pool.valid(lease), true);
        assert.equal(lease.probe, true);
        tested.push(lease.url);
        assert.equal(pool.leases.get(peerId), peer);
        assert.equal(peer.controller.signal.aborted, false);
        return { ok: lease.url.endsWith('/working.m3u8') };
      }, install: async result => installed.push(result), refresh: () => {},
    });
    const result = await repair(playback, bad);
    assert.equal(result.provider_sources[provider], 'https://test.example/working.m3u8');
    assert.deepEqual(tested, ['https://test.example/hevc.m3u8', 'https://test.example/working.m3u8']);
    assert.equal(installed.length, 1);
    assert.equal(pool.leases.get(peerId), peer);
    assert.equal(pool.demands.get(bad.key).viewers.has('prewarm:shared'), true);
    assert.equal(pool.failures[provider], 0, 'a bad edition must not quarantine the whole account');
  });
}

test('automatic repair is coalesced, bounded and backs off when all editions fail', async t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const playback = { match_id: 'target', channel_id: 'TV', provider_sources: { A: 'https://test.example/old.m3u8' } };
  const lease = pool.acquire(playback, 'prewarm:target');
  let now = 0, discoveries = 0, probes = 0;
  const repair = createAutomaticChannelRepair({ pool, now: () => now,
    discover: async (channel, _ids, verify) => {
      discoveries++;
      for (let index = 0; index < 30; index++) await verify('A', { original_url: `https://test.example/${index}.m3u8` }, channel);
    }, warm: async () => { probes++; return { ok: false }; },
    install: () => { throw new Error('must not install a failed source'); }, refresh: () => {},
  });
  await Promise.all([repair(playback, lease), repair(playback, lease)]);
  assert.equal(discoveries, 1); assert.equal(probes, 8);
  await repair(playback, lease); assert.equal(discoveries, 1);
  now = 300_001; await repair(playback, lease); assert.equal(discoveries, 2);
});

test('automatic repair cannot probe or replace an unrelated occupied provider', async t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const playback = { match_id: 'target', channel_id: 'TV', provider_sources: { A: 'https://test.example/old.m3u8' } };
  const old = pool.acquire(playback, 'prewarm:target');
  pool.demands.delete(old.key); pool.revoke('A');
  const peer = pool.acquire({ match_id: 'peer', channel_id: 'Other TV', provider_sources: { A: 'https://test.example/peer.m3u8' } }, 'prewarm:peer');
  const repair = createAutomaticChannelRepair({ pool,
    discover: async (channel, _ids, verify) => {
      assert.equal(await verify('A', { original_url: 'https://test.example/new.m3u8' }, channel), false);
      return { resolvedChannel: channel, provider_sources: { A: 'https://test.example/new.m3u8' } };
    }, warm: () => { throw new Error('must not interrupt peer'); },
    install: () => { throw new Error('unverified discovery must not be installed'); }, refresh: () => {},
  });
  assert.equal(await repair(playback, old), null);
  assert.equal(pool.leases.get('A'), peer);
  assert.equal(peer.controller.signal.aborted, false);
});

test('operator activity cancels background edition search without installing or imposing backoff', async t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const playback = { match_id: 'target', channel_id: 'TV', provider_sources: { A: 'https://test.example/old.m3u8' } };
  const lease = pool.acquire(playback, 'prewarm:target');
  let active = true, discoveries = 0;
  const repair = createAutomaticChannelRepair({ pool,
    discover: async (channel, _ids, verify) => {
      discoveries++; active = false;
      assert.equal(await verify('A', { original_url: 'https://test.example/new.m3u8' }, channel), false);
    }, warm: () => { throw new Error('operator should take priority'); },
    install: () => { throw new Error('cancelled search must not install'); }, refresh: () => {},
  });
  assert.equal(await repair(playback, lease, { shouldContinue: () => active }), null);
  active = true;
  await repair(playback, lease, { shouldContinue: () => active });
  assert.equal(discoveries, 2);
});
