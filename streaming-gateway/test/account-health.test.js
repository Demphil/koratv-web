import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountHealth } from '../account-health.js';
import { ProviderPool, PROVIDER_IDS, PoolError } from '../provider-pool.js';

test('diagnostic heartbeats preserve slow in-flight leases without resurrecting revoked leases', t => {
  let now = 0; const pool = new ProviderPool({ now: () => now }); t.after(() => pool.close());
  const lease = pool.acquire({ match_id: 'slow', provider_sources: { A: 'https://a.example/slow' } }, 'probe');
  now = 14000; assert.equal(pool.touch(lease, 'probe'), true);
  now = 20000; pool.rebalance(); assert.equal(pool.valid(lease), true);
  pool.revoke('A'); assert.equal(pool.touch(lease, 'probe'), false);
});

test('six accounts isolate the seventh request and fail over only to free accounts', t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const playback = id => ({ pool_key: id, match_id: id, channel_id: id, priority_score: 100,
    provider_sources: Object.fromEntries(PROVIDER_IDS.map(p => [p, `https://${p.toLowerCase()}.example/${id}.m3u8`])) });
  const leases = PROVIDER_IDS.map(p => pool.acquire(playback(p), p));
  assert.deepEqual(leases.map(l => l.provider), PROVIDER_IDS);
  assert.throws(() => pool.acquire({ ...playback('seventh'), priority_score: 10 }, 'seventh'), PoolError);
  pool.fail(leases[5]);
  assert.ok(leases.slice(0,5).every(l => pool.valid(l)));
  pool.revoke('E'); pool.demands.delete('E');
  assert.equal(pool.acquire(playback('F'), 'F').provider, 'E');
});

test('health distinguishes actual expiry, cooldown and recovery; private file never includes passwords', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'account-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = 1000000, expired = false;
  const accounts = () => ({ B: { enabled: true, id: 'Account_2_test', username: 'test', server: 'https://provider.example', sourceUrl: 'https://provider.example/live/test/secret-password/1.m3u8', expiresAt: '2000-01-01' } });
  const path = join(dir, 'accounts-status.json');
  const health = new AccountHealth({ accounts, path, now: () => now, fetchImpl: async () => new Response(JSON.stringify({user_info:{ auth: expired ? 0 : 1, status: expired ? 'Expired' : 'Active', exp_date: '1' }})) });
  const pool = new ProviderPool({ now: () => now, health }); health.pool = pool; t.after(() => pool.close());
  const playback = { match_id: 'match', channel_id: 'sport', provider_sources: { B: accounts().B.sourceUrl } };
  pool.acquire(playback, 'viewer');
  await health.check();
  assert.equal(health.snapshot()[1].status, 'BUSY_STREAMING');
  health.observe('B', 200); health.persist();
  assert.doesNotMatch(readFileSync(path, 'utf8'), /secret-password|sourceUrl/);
  for (let i=0;i<3;i++) { const lease = pool.acquire(playback,'viewer'); pool.fail(lease,403); now += i<2 ? 31000 : 0; }
  assert.equal(health.snapshot()[1].status, 'COOLDOWN_403');
  assert.equal(health.snapshot()[1].stopped_reason, 'persistent_upstream_403');
  assert.ok(pool.blocked.get('B') - now >= 300000);
  expired = true; await health.check();
  assert.equal(health.snapshot()[1].status, 'STOPPED_EXPIRED');
  assert.throws(() => pool.acquire(playback,'viewer'), PoolError);
  expired = false; await health.check();
  assert.equal(health.snapshot()[1].status, 'BUSY_STREAMING');
  assert.ok(Number.isFinite(pool.blocked.get('B') || 0));
});
