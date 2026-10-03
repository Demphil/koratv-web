import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotReader } from '../snapshot-cache.js';

test('concurrent first visitors share one read and cache age starts when it completes', async () => {
  let now = 0, reads = 0, complete;
  const reader = createSnapshotReader(() => { reads++; return new Promise(resolve => { complete = resolve; }); }, { now: () => now, ttlMs: 10 });
  const first = reader(), second = reader();
  await Promise.resolve();
  now = 100;
  complete(['fresh']);
  assert.deepEqual(await first, ['fresh']);
  assert.deepEqual(await second, ['fresh']);
  assert.deepEqual(await reader(), ['fresh']);
  assert.equal(reads, 1);
});

test('expired snapshots refresh once without holding readers; old data has a hard bound', async () => {
  let now = 0, reads = 0, complete;
  const reader = createSnapshotReader(() => ++reads === 1 ? ['old'] : new Promise(resolve => { complete = resolve; }), { now: () => now, ttlMs: 10, staleMs: 20 });
  await reader();
  now = 11;
  assert.deepEqual(await reader(), ['old']);
  assert.deepEqual(await reader(), ['old']);
  assert.equal(reads, 2);
  now = 31;
  const blocked = reader();
  complete(['new']);
  assert.deepEqual(await blocked, ['new']);
  assert.equal(reads, 2);
});
