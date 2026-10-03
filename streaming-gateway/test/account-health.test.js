import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountHealth } from '../account-health.js';
import { ProviderPool, PROVIDER_IDS, PoolError } from '../provider-pool.js';

test('management 403 neither revokes working media nor perpetually renews a media cooldown', async t => {
  let now = 1000000;
  const dir = mkdtempSync(join(tmpdir(), 'account-metadata-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const health = new AccountHealth({ accounts: () => ({ B: { enabled: true, sourceUrl: 'https://provider.example/live/user/pass/1.m3u8' } }),
    path: join(dir, 'accounts-status.json'), now: () => now, fetchImpl: async () => new Response('Forbidden', { status: 403 }) });
  const pool = new ProviderPool({ now: () => now, health }); health.pool = pool; t.after(() => pool.close());
  const playback = { match_id: 'live', provider_sources: { B: 'https://provider.example/live/user/pass/1.m3u8' } };
  const lease = pool.acquire(playback, 'viewer');
  await health.check();
  assert.equal(pool.valid(lease), true);
  assert.equal(health.snapshot()[1].status, 'BUSY_STREAMING');
  pool.fail(lease, 403);
  const until = pool.blocked.get('B');
  now += 10000; await health.check();
  assert.equal(pool.blocked.get('B'), until);
  now = until + 1; await health.check();
  assert.equal(pool.acquire(playback, 'viewer').provider, 'B');
});

test('diagnostic heartbeats preserve slow in-flight leases without resurrecting revoked leases', t => {
  let now = 0; const pool = new ProviderPool({ now: () => now }); t.after(() => pool.close());
  const lease = pool.acquire({ match_id: 'slow', provider_sources: { A: 'https://a.example/slow' } }, 'probe');
  now = 14000; assert.equal(pool.touch(lease, 'probe'), true);
  now = 20000; pool.rebalance(); assert.equal(pool.valid(lease), true);
  pool.revoke('A'); assert.equal(pool.touch(lease, 'probe'), false);
});

test('ten accounts isolate the eleventh request and fail over only to free accounts', t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const playback = id => ({ pool_key: id, match_id: id, channel_id: id, priority_score: 100,
    provider_sources: Object.fromEntries(PROVIDER_IDS.map(p => [p, `https://${p.toLowerCase()}.example/${id}.m3u8`])) });
  const leases = PROVIDER_IDS.map(p => pool.acquire(playback(p), p));
  assert.deepEqual(leases.map(l => l.provider), PROVIDER_IDS);
  assert.throws(() => pool.acquire({ ...playback('eleventh'), priority_score: 10 }, 'eleventh'), PoolError);
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

test('stalled HLS sequence is reported separately and a successful media response clears it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'account-stalled-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = 1000;
  const health = new AccountHealth({ accounts: () => ({ B: { enabled: true, username: 'licensed', server: 'https://provider.example' } }),
    path: join(dir, 'accounts-status.json'), now: () => now });
  const pool = new ProviderPool({ now: () => now, health }); health.pool = pool; t.after(() => pool.close());
  health.stalled('B');
  assert.equal(health.snapshot()[1].status, 'STALLED');
  assert.equal(health.snapshot()[1].stopped_reason, 'stalled_hls_media_sequence');
  now += 1000;
  health.observe('B', 200, true);
  assert.equal(health.snapshot()[1].status, 'ACTIVE');
});
