import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneMatchData } from '../scripts/prune-match-data.js';

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
