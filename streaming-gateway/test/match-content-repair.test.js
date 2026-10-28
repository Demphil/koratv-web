import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPool } from '../provider-pool.js';
import { createMatchContentRepair } from '../match-content-repair.js';

function setup(t) {
  const now = Date.parse('2026-10-28T17:30:00Z');
  const pool = new ProviderPool({ now: () => now }); t.after(() => pool.close());
  const match = { match_id: 'target', home_team: 'Venezia', away_team: 'Inter', kickoff_time: new Date(now).toISOString(), payload: { status: 'LIVE', channels: ['Tring Sport 1 HD'] } };
  const playback = { match_id: 'target', channel_id: 'Tring Sport 1 HD', provider_sources: { A: 'https://test.example/current.m3u8' } };
  const lease = pool.acquire(playback, 'prewarm:target'); pool.touch(lease, 'real-viewer');
  const peer = pool.acquire({ match_id: 'peer', channel_id: 'Other TV', provider_sources: { B: 'https://test.example/peer.m3u8' } }, 'real-peer');
  return { now, pool, match, playback, lease, peer };
}

test('automatic content checks cannot probe an occupied provider even if a caller raced its inventory', async t => {
  const { pool, peer } = setup(t);
  await assert.rejects(pool.probe('B', 'New TV', 'https://test.example/new', () => assert.fail('must not inspect'), { idleOnly: true }), /provider_busy/);
  assert.equal(pool.valid(peer), true); assert.equal(peer.controller.signal.aborted, false);
});

test('only confirmed content on an idle, unreserved provider can replace one target', async t => {
  const { pool, match, playback, lease, peer, now } = setup(t);
  let committed = 0;
  const repair = createMatchContentRepair({ pool, now: () => now, accounts: () => ({ A: { enabled: true }, B: { enabled: true }, C: { enabled: true }, D: { enabled: true } }),
    assignments: () => ({ assignments: [{ matchId: 'other-upcoming', providerId: 'D' }] }),
    discover: async (channel, ids, verify) => {
      assert.deepEqual(ids, ['C']);
      const candidate = { original_url: 'https://test.example/good.m3u8' };
      assert.equal(await verify('C', candidate, channel), true);
      return { resolvedChannel: channel, provider_sources: { C: candidate.original_url } };
    }, warm: async (p, probe, options) => {
      assert.equal(probe.probe, true); assert.equal(options.requireContent, true);
      assert.equal(pool.valid(lease), true); assert.equal(pool.valid(peer), true);
      return { ok: true, content: { status: 'verified', checkedAt: new Date(now).toISOString() } };
    }, commit: async input => { committed++; assert.equal(input.guard(), true); return { status: 'corrected' }; } });
  assert.equal((await repair({ match, playback, lease, revision: 3 })).status, 'corrected');
  assert.equal(committed, 1); assert.equal(pool.valid(lease), true); assert.equal(pool.valid(peer), true);
  assert.equal(peer.controller.signal.aborted, false);
});

test('working media with unknown or wrong teams is never installed', async t => {
  const { pool, match, playback, lease, now } = setup(t);
  for (const status of ['pending', 'mismatch']) {
    const repair = createMatchContentRepair({ pool, now: () => now, accounts: () => ({ C: { enabled: true } }), assignments: () => ({ assignments: [] }),
      discover: async (channel, ids, verify) => {
        assert.equal(await verify('C', { original_url: 'https://test.example/not-confirmed' }, channel), false);
        return null;
      }, warm: async () => ({ ok: true, content: { status } }), commit: () => assert.fail('must not commit') });
    assert.equal((await repair({ match, playback, lease })).status, 'no_confirmed_alternative');
  }
});

test('no free account waits without replacing or disconnecting watched matches', async t => {
  const { pool, match, playback, lease, peer, now } = setup(t);
  const repair = createMatchContentRepair({ pool, now: () => now, accounts: () => ({ A: { enabled: true }, B: { enabled: true } }),
    assignments: () => ({ assignments: [] }), discover: () => assert.fail('no upstream lookup'), commit: () => assert.fail('no commit') });
  assert.equal((await repair({ match, playback, lease })).status, 'waiting_free_provider');
  assert.equal(pool.valid(peer), true); assert.equal(pool.valid(lease), true);
});

test('a provider acquired between testing and committing invalidates the transfer', async t => {
  const { pool, match, playback, lease, now } = setup(t);
  const repair = createMatchContentRepair({ pool, now: () => now, accounts: () => ({ C: { enabled: true } }), assignments: () => ({ assignments: [] }),
    discover: async (channel, ids, verify) => {
      const candidate = { original_url: 'https://test.example/good' };
      await verify('C', candidate, channel);
      pool.acquire({ match_id: 'new-peer', channel_id: 'Peer 2', provider_sources: { C: 'https://test.example/peer2' } }, 'new-viewer');
      return { resolvedChannel: channel, provider_sources: { C: candidate.original_url } };
    }, warm: async () => ({ ok: true, content: { status: 'verified', checkedAt: new Date(now).toISOString() } }),
    commit: () => assert.fail('must not commit') });
  assert.equal(await repair({ match, playback, lease }), null);
  assert.equal(pool.leases.get('C').channel, 'Peer 2');
});
