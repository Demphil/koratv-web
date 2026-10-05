import test from 'node:test';
import assert from 'node:assert/strict';
import { currentConsoleSelection } from '../operator/selection.js';

const matches = [
  { matchId: 'france', broadcastRank: 1, viewingMode: 'live_updates' },
  { matchId: 'italy', broadcastRank: 2, viewingMode: 'stream' },
  { matchId: 'unassigned', viewingMode: 'live_updates' }
];

test('yesterday selection cannot contaminate today checkbox state or save payload', () => {
  const result = currentConsoleSelection({ day: '2026-10-05', matches,
    state: { selection: { date: '2026-10-04', enabled: true, matches: ['old-fixture'] } } });
  assert.deepEqual(result, { enabled: false, matches: ['france', 'italy'] });
});

test('current manual order is retained while stale and duplicate IDs are removed', () => {
  const result = currentConsoleSelection({ day: '2026-10-05', matches,
    state: { selection: { date: '2026-10-05', enabled: true, matches: ['italy', 'old-fixture', 'france', 'italy'] } } });
  assert.deepEqual(result, { enabled: true, matches: ['italy', 'france'] });
});
