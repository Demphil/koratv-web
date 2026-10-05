import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deactivateRowsOutsideDailyWindow,
  pruneMatchData,
  staleDailyRows
} from '../scripts/prune-match-data.js';

test('pruning uses version-checked deletes and never writes channel inventory', async () => {
  const now = Date.parse('2026-09-27T16:00:00Z');
  const old = { id: 1, match_id: 'old', source: 'kooora', kickoff_time: '2026-09-26T15:59:00Z', updated_at: '2026-09-26T15:59:00Z' };
  const calls = [];
  const supabase = { from(table) {
    calls.push(['table', table]);
    let deleting = false;
    return {
      select() { return deleting ? Promise.resolve({ data: [], error: null }) : this; },
      order() { return this; },
      range() { return Promise.resolve({ data: [old], error: null }); },
      delete() { deleting = true; return this; },
      eq(key, value) { calls.push(['eq', key, value]); return this; },
      lt(key, value) { calls.push(['lt', key, value]); return Promise.resolve({ error: null }); },
    };
  } };
  assert.equal(await pruneMatchData(supabase, 'matches', now), 0);
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'updated_at' && x[2] === old.updated_at));
  assert.deepEqual(calls.filter(x => x[0] === 'table').map(x => x[1]), ['matches', 'matches', 'channel_language_alternatives']);
  assert.deepEqual(calls.at(-1), ['lt', 'updated_at', '2026-09-26T16:00:00.000Z']);
});

test('daily rollover only deactivates old managed match rows', async () => {
  const today = { id: 1, source: 'kooora', kickoff_time: '2026-10-03T19:00:00Z', active: true, updated_at: 'today-version' };
  const old = { id: 2, source: 'kooora-schedule', kickoff_time: '2026-10-02T19:00:00Z', active: true, updated_at: 'old-version' };
  const inactiveOld = { id: 3, source: 'api-football', kickoff_time: '2026-10-02T21:00:00Z', active: false, updated_at: 'inactive-version' };
  const manualOld = { id: 4, source: 'manual', kickoff_time: '2026-10-02T21:00:00Z', active: true, updated_at: 'manual-version' };
  const tomorrow = { ...today, id: 5, kickoff_time: '2026-10-04T19:00:00Z' };

  assert.deepEqual(staleDailyRows([today, old, inactiveOld, manualOld, tomorrow], '2026-10-03'), [old]);

  const calls = [];
  const supabase = { from(table) {
    calls.push(['table', table]);
    let mode = 'read';
    return {
      select() {
        if (mode === 'update') return Promise.resolve({ data: [{ id: old.id }], error: null });
        return this;
      },
      order() { return this; },
      range() { return Promise.resolve({ data: [today, old, inactiveOld, manualOld], error: null }); },
      update(payload) { mode = 'update'; calls.push(['update', table, payload]); return this; },
      eq(key, value) { calls.push(['eq', key, value]); return this; },
      is(key, value) { calls.push(['is', key, value]); return this; }
    };
  } };

  assert.equal(await deactivateRowsOutsideDailyWindow(supabase, 'matches', '2026-10-03'), 1);
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'matches' && x[2].active === false));
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'id' && x[2] === old.id));
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'updated_at' && x[2] === old.updated_at));
  assert.ok(!calls.some(x => x[0] === 'eq' && x[1] === 'id' && x[2] === today.id));
});

test('completed fixtures remain protected through 23:59:59 Morocco time', async () => {
  const { obsoleteMatchRows } = await import('../../shared/match-broadcasts.mjs');
  const ended = { id: 1, match_id: 'ended', source: 'kooora', kickoff_time: '2026-10-03T00:01:00Z', updated_at: '2026-10-02T12:00:00Z', payload: { status: 'RESULT', isFinished: true } };
  assert.deepEqual(obsoleteMatchRows([ended], [], Date.parse('2026-10-03T22:59:59.999Z')), []);
  assert.deepEqual(obsoleteMatchRows([ended], [], Date.parse('2026-10-03T23:00:00Z')), [ended]);
});

test('new snapshots are stored before cleanup and a failed write never cleans old data', async () => {
  const { syncMatchesDaily } = await import('../scripts/sync-matches-daily.js');
  const calls = [], db = {};
  const services = { collectRows: async () => [{ match_id: 'new-day' }], createClient: () => db,
    upsertRows: async () => { calls.push('write'); return { upserted: 1 }; },
    cleanupDay: async () => { calls.push('rollover'); return {}; }, pruneRows: async () => { calls.push('prune'); return 0; } };
  await syncMatchesDaily(services); assert.deepEqual(calls, ['write', 'rollover', 'prune']);
  calls.length = 0;
  await assert.rejects(syncMatchesDaily({ ...services, upsertRows: async () => { calls.push('write'); throw new Error('storage_unavailable'); } }), /storage_unavailable/);
  assert.deepEqual(calls, ['write']);
});
