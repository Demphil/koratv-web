import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppCacheClient } from './player-app-cache.mjs';
test('shared app cache reads cannot trigger provider endpoints or expose the application API key', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'player-app-cache-')); let calls = 0, time = Date.now();
  const options = { origin: 'https://api.korascoreai.com', publicKey: 'public-client-test', cacheDir, now: () => time,
    fetchImpl: async (url, init) => {
      calls++; assert.equal(url, 'https://api.korascoreai.com/functions/v1/sports');
      assert.deepEqual(JSON.parse(init.body), { resource: 'liveFixtures', params: {} });
      assert.equal(init.headers['x-apisports-key'], undefined);
      return new Response(JSON.stringify([{ fixture: { id: 123, date: '2026-11-27T20:00:00Z' }, teams: { home: { id: 1 }, away: { id: 2 } } }]));
    } };
  try {
    const client = createAppCacheClient(options);
    assert.equal((await client.request('/fixtures', { date: '2026-11-27' })).length, 1);
    await client.request('/fixtures', { id: 123 }); assert.equal(calls, 1);
    const restarted = createAppCacheClient(options); await restarted.request('/fixtures', { id: 123 }); assert.equal(calls, 1);
    assert.equal(restarted.quota().providerRequests, 0);
    await assert.rejects(client.request('/fixtures/statistics', { fixture: 123 }), /denied/);
    await assert.rejects(client.request('/fixtures', { live: 'all' }), /denied/);
    for (const name of await readdir(cacheDir)) assert.ok(!(await readFile(join(cacheDir, name), 'utf8')).includes(options.publicKey));
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});
