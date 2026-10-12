import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballClient } from '../scripts/api-football-client.mjs';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const options = { key: 'private-test-only', baseUrl: 'https://v3.football.api-sports.io', minIntervalMs: 0, sleep: async () => {} };
test('API client retries bounded transient errors and handles provider error objects on HTTP 200', async () => {
  let calls = 0;
  const client = createApiFootballClient({ ...options, fetchImpl: async (_, init) => {
    assert.ok(init.signal);
    assert.equal(init.headers['x-apisports-key'], options.key);
    calls++;
    return new Response(JSON.stringify(calls === 1 ? { errors: { rateLimit: 'slow down' } } : { response: [42] }));
  } });
  assert.deepEqual(await client.request('/fixtures', { ids: '42' }), [42]);
  assert.equal(calls, 2);
});

test('equivalent simultaneous queries share one call and return isolated snapshots', async () => {
  let calls = 0;
  const client = createApiFootballClient({ ...options, fetchImpl: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 5));
    return new Response('{"response":[{"fixture":{"id":42}}]}');
  } });
  const [a, b] = await Promise.all([client.request('/fixtures', { ids: '42-9' }, { ttlMs: 60000 }),
    client.request('/fixtures', { ids: '9-42-9' }, { ttlMs: 60000 })]);
  a[0].fixture.id = 0;
  assert.equal(b[0].fixture.id, 42);
  assert.equal((await client.request('/fixtures', { ids: '9-42' }, { ttlMs: 60000 }))[0].fixture.id, 42);
  assert.equal(calls, 1);
  assert.equal(client.quota().deduplicated, 1);
});

test('persistent cache and daily budget survive separate clients and reset at UTC midnight', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'football-client-'));
  let calls = 0, time = Date.parse('2026-10-12T23:59:00Z');
  const create = () => createApiFootballClient({ ...options, cacheDir, dailyBudget: 1, now: () => time,
    fetchImpl: async () => { calls++; return new Response('{"response":[42]}'); } });
  try {
    const first = create();
    await first.request('/fixtures', { id: 42 }, { ttlMs: 120000 });
    const second = create();
    assert.deepEqual(await second.request('/fixtures', { id: 42 }, { ttlMs: 120000 }), [42]);
    await assert.rejects(second.request('/leagues'), /budget exhausted/);
    time = Date.parse('2026-10-13T00:00:01Z');
    await second.request('/leagues');
    assert.equal(calls, 2);
    for (const dir of await readdir(cacheDir)) for (const file of await readdir(join(cacheDir, dir))) {
      assert.equal((await readFile(join(cacheDir, dir, file), 'utf8')).includes(options.key), false);
    }
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('cache misses across worker clients are locked and failed responses never enter the cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'football-shared-'));
  let calls = 0;
  const fetchImpl = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return new Response('{"response":[]}'); };
  try {
    const clients = [0, 1].map(() => createApiFootballClient({ ...options, cacheDir, fetchImpl }));
    await Promise.all(clients.map(c => c.request('/fixtures', { id: 9 }, { ttlMs: 60000 })));
    assert.equal(calls, 1);
    const failed = createApiFootballClient({ ...options, cacheDir, fetchImpl: async () => new Response('{"errors":{"token":"invalid"}}', { status: 401 }) });
    await assert.rejects(failed.request('/leagues', {}, { ttlMs: 60000 }), /401/);
    const healthy = createApiFootballClient({ ...options, cacheDir, fetchImpl });
    await healthy.request('/leagues', {}, { ttlMs: 60000 });
    assert.equal(calls, 2);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('Arabic search is rejected before consuming quota, while English names and IDs work', async () => {
  let calls = 0;
  const client = createApiFootballClient({ ...options, fetchImpl: async () => { calls++; return new Response('{"response":[]}'); } });
  await assert.rejects(client.request('/players', { search: 'محمد' }), /English/);
  await client.request('/players', { search: 'Salah', team: 40, season: 2026 });
  assert.equal(calls, 1);
});

test('provider quota reserve prevents retries and clears on the next UTC day', async () => {
  let calls = 0, time = Date.parse('2026-10-12T23:59:59Z');
  const client = createApiFootballClient({ ...options, quotaReserve: 100, now: () => time,
    fetchImpl: async () => { calls++; return new Response('{"response":[]}', { headers: { 'x-ratelimit-requests-remaining': '100' } }); } });
  await client.request('/fixtures');
  await assert.rejects(client.request('/leagues'), /reserved/);
  assert.equal(calls, 1);
  time += 2000;
  await client.request('/leagues');
  assert.equal(calls, 2);
  assert.throws(() => createApiFootballClient({ ...options, dailyBudget: NaN }), /Invalid/);
});
test('authentication failure is not retried and daily quota stops subsequent requests', async () => {
  let calls = 0;
  const denied = createApiFootballClient({ ...options, fetchImpl: async () => { calls++; return new Response('{}', { status: 401 }); } });
  await assert.rejects(denied.request('/fixtures'), /401/);
  assert.equal(calls, 1);
  const exhausted = createApiFootballClient({ ...options, fetchImpl: async () => { calls++; return new Response('{"response":[]}', { headers: { 'x-ratelimit-requests-remaining': '0' } }); } });
  await exhausted.request('/fixtures');
  await assert.rejects(exhausted.request('/leagues'), /quota exhausted/);
  assert.equal(calls, 2);
});
test('concurrent API calls are serialized and malformed replies cannot become authoritative emptiness', async () => {
  let active = 0, peak = 0;
  const client = createApiFootballClient({ ...options, fetchImpl: async () => {
    active++; peak = Math.max(active, peak);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return new Response('{"response":[]}');
  } });
  await Promise.all([client.request('/fixtures'), client.request('/leagues')]);
  assert.equal(peak, 1);
  const malformed = createApiFootballClient({ ...options, fetchImpl: async () => new Response('{"results":0}') });
  await assert.rejects(malformed.request('/fixtures'), /invalid_response/);
});
