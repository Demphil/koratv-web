import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectAssignmentPlan, writeProjectAssignmentsToSupabase } from '../scripts/resource-assignment.js';

test('paused resource rows keep an integer priority when mirrored to storage', async () => {
  const id = 'stopped', now = new Date('2026-10-17T14:00:00Z');
  const plan = buildProjectAssignmentPlan({ now, matches: [{ match_id: id, home_team: 'Morocco', away_team: 'Mali',
    league: 'International Friendlies', kickoff_time: now.toISOString(), active: true, payload: { status: 'LIVE' } }],
    routeStates: { [id]: { status: 'RESOLVED', resolvedChannel: 'Exact TV', providerIds: ['A'] } },
    providerCatalog: { providers: { A: { enabled: true } } }, pausedMatches: { [id]: { day: '2026-10-17' } },
  });
  assert.equal(plan.ignored[0].reason, 'operator_paused');
  assert.ok(Number.isFinite(plan.ignored[0].priorityScore));
  let written;
  const db = { from: () => ({ upsert: rows => { written = JSON.parse(JSON.stringify(rows));
    return { select: async () => ({ data: rows.map(row => ({ match_id: row.match_id })), error: rows.some(row => !Number.isInteger(row.priority_score)) ? { code: '23502' } : null }) }; } }) };
  assert.equal((await writeProjectAssignmentsToSupabase(db, {}, '2026-10-17', plan)).written, 1);
  assert.equal(written[0].status, 'WAITING');
  assert.ok(Number.isInteger(written[0].priority_score));
  plan.ignored[0].priorityScore = undefined;
  await writeProjectAssignmentsToSupabase(db, {}, '2026-10-17', plan);
  assert.equal(written[0].priority_score, 0, 'legacy paused plans cannot send a null NOT NULL column');
});
