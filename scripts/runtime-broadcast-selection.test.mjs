import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshBroadcastSelection, isSelectedBroadcast, validateBroadcastSelection } from '../shared/broadcast-selection.mjs';

test('runtime operator selection replaces the archived list, supports empty selection, and coalesces polls', async () => {
  let calls = 0;
  const id = 'kooora_2026-11-28_الاتفاق_vs_الهلال';
  const load = async () => { calls++; return Response.json({ version: 1, revision: 10, enabled: true, matches: [id] }); };
  await Promise.all([refreshBroadcastSelection({ fetchImpl: load, now: 1000, force: true }), refreshBroadcastSelection({ fetchImpl: load, now: 1000, force: true })]);
  assert.equal(calls, 1);
  assert.equal(isSelectedBroadcast(id), true);
  assert.equal(isSelectedBroadcast('kooora_2026-11-27_بريست_vs_باريس'), false);
  await refreshBroadcastSelection({ force: true, now: 2000, fetchImpl: async () => Response.json({ version: 1, revision: 11, enabled: true, matches: [] }) });
  assert.equal(isSelectedBroadcast(id), false);
  await refreshBroadcastSelection({ force: true, now: 3000, fetchImpl: load });
  assert.equal(isSelectedBroadcast(id), false, 'old responses cannot restore a removed selection');
  assert.throws(() => validateBroadcastSelection({ version: 1, revision: 1, enabled: true, matches: ['https://external.example'] }));
});
