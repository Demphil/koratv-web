import assert from 'node:assert/strict';
import test from 'node:test';
import { HlsResourceCache } from '../hls-resource-cache.js';

test('coalesces concurrent resource reads and serves an LRU hit from memory', async () => {
  const cache = new HlsResourceCache({ maxBytes: 32, maxEntryBytes: 16 });
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = async () => {
    calls += 1;
    await gate;
    return new Response('segment-bytes', { headers: { 'content-type': 'video/mp2t' } });
  };
  const first = cache.load('segment:a', { ttlMs: 10_000 }, loader);
  const second = cache.load('segment:a', { ttlMs: 10_000 }, loader);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(await a.text(), 'segment-bytes');
  assert.equal(await b.text(), 'segment-bytes');
  assert.equal(await (await cache.load('segment:a', { ttlMs: 10_000 }, loader)).text(), 'segment-bytes');
  assert.equal(calls, 1);
  assert.equal(cache.stats().coalesced, 1);
  assert.equal(cache.stats().hits, 1);
});

test('expires manifests and evicts least-recently-used entries within the byte bound', async () => {
  const cache = new HlsResourceCache({ maxBytes: 10, maxEntryBytes: 10 });
  const put = (key, value, ttlMs = 10_000) => cache.load(key, { ttlMs }, async () => new Response(value));
  await put('a', '123456');
  await put('b', '7890');
  await cache.load('a', { ttlMs: 10_000 }, async () => new Response('unused'));
  await put('c', 'ab');
  assert.equal(cache.stats().bytes, 8);
  assert.equal(cache.entries.has('a'), true);
  assert.equal(cache.entries.has('b'), false);
  await put('manifest', '#EXTM3U', 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await (await put('manifest', '#EXTM3U')).text(), '#EXTM3U');
  assert.equal(cache.stats().misses, 5);
});

test('prefetch queue is bounded and warms segment cache', async () => {
  const cache = new HlsResourceCache({ maxBytes: 32, maxEntryBytes: 16, prefetchConcurrency: 1, maxPrefetchQueue: 2 });
  let calls = 0;
  const loader = async () => { calls += 1; return new Response(`segment-${calls}`); };
  cache.schedulePrefetch('1', { ttlMs: 10_000 }, loader);
  cache.schedulePrefetch('2', { ttlMs: 10_000 }, loader);
  cache.schedulePrefetch('3', { ttlMs: 10_000 }, loader);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  assert.ok(cache.stats().prefetched >= 1);
  assert.equal(cache.prefetchQueue.length, 0);
});
