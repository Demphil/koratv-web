import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectAssignmentPlan } from '../scripts/resource-assignment.js';

test('actual playback ownership replaces stale reservations and frees a healthy idle provider', () => {
  const now = new Date('2026-10-12T19:30:00Z');
  const matches = ['first','second'].map((id, index) => ({ match_id: id, source: 'kooora', active: true,
    home_team: `Home ${index}`, away_team: `Away ${index}`, league: 'La Liga', kickoff_time: now.toISOString(), payload: { status: 'LIVE', sourceMatchId: `source-${id}` } }));
  const input = { now, matches, manualMatchIds: ['first','second'],
    routeStates: { first: { status: 'RESOLVED', resolvedChannel: 'First TV', providerIds: ['G','I'] },
      second: { status: 'RESOLVED', resolvedChannel: 'Second TV', providerIds: ['B','G'] } },
    providerCatalog: { providers: { B: { enabled: true }, G: { enabled: true }, I: { enabled: true } } },
    previousAssignments: [{ matchId: 'first', providerId: 'G' }, { matchId: 'second', providerId: 'B' }],
    runtimeHealth: { updated_at: now.toISOString(), accounts: [
      { provider: 'I', status: 'BUSY_STREAMING', current_match: '2026-10-12:source-first:First TV', current_channel: 'First TV' },
      { provider: 'G', status: 'ACTIVE' },
      { provider: 'B', status: 'COOLDOWN_403', cooldown_until: '2026-10-12T19:35:00Z' },
    ] } };
  const result = buildProjectAssignmentPlan(input);
  assert.deepEqual(result.assignments.map(row => [row.matchId,row.providerId]), [['first','I'],['second','G']]);
  assert.equal(result.assignments.every(row => row.manual), true);
  assert.equal(input.providerCatalog.providers.B.enabled, true);
  const stale = buildProjectAssignmentPlan({ ...input, runtimeHealth: { ...input.runtimeHealth, updated_at: '2026-10-12T19:28:00Z' } });
  assert.deepEqual(stale.assignments.map(row => row.providerId), ['G','B']);
  const elapsed = buildProjectAssignmentPlan({ ...input, now: new Date('2026-10-12T19:35:01Z'), runtimeHealth: { ...input.runtimeHealth, updated_at: '2026-10-12T19:35:01Z' } });
  assert.deepEqual(elapsed.assignments.map(row => row.providerId), ['I','B']);
});

test('fresh stopped accounts are excluded but unknown or stale health does not permanently disable resources', () => {
  const now = new Date('2026-10-12T19:30:00Z');
  const input = { now, matches: [{ match_id: 'fixture', league: 'La Liga', active: true, kickoff_time: now.toISOString(), payload: { status: 'LIVE' } }],
    routeStates: { fixture: { status: 'RESOLVED', resolvedChannel: 'Fixture TV', providerIds: ['A','B'] } },
    providerCatalog: { providers: { A: { enabled: true }, B: { enabled: true } } },
    runtimeHealth: { updated_at: now.toISOString(), accounts: [{ provider: 'A', status: 'STOPPED_EXPIRED' }, { provider: 'B', status: 'UNAVAILABLE_SYNC' }] } };
  assert.equal(buildProjectAssignmentPlan(input).assignments.length, 0);
  assert.equal(buildProjectAssignmentPlan({ ...input, runtimeHealth: {} }).assignments.length, 1);
});

test('a later live match keeps its active provider instead of being displaced by an earlier manual row', () => {
  const now = new Date('2026-10-12T19:30:00Z');
  const input = { now, manualMatchIds: ['new','playing'],
    matches: ['new','playing'].map(id=>({ match_id:id, league:'La Liga', active:true, kickoff_time:now.toISOString(), payload:{status:'LIVE'} })),
    routeStates: { new:{status:'RESOLVED',resolvedChannel:'New TV',providerIds:['H','G']}, playing:{status:'RESOLVED',resolvedChannel:'Playing TV',providerIds:['H','G']} },
    providerCatalog:{providers:{H:{enabled:true},G:{enabled:true}}},
    runtimeHealth:{updated_at:now.toISOString(),accounts:[{provider:'H',status:'BUSY_STREAMING',current_match:'playing',current_channel:'Playing TV'}]} };
  assert.deepEqual(buildProjectAssignmentPlan(input).assignments.map(row=>[row.matchId,row.providerId]),[['new','G'],['playing','H']]);
  const explicitReplacement = buildProjectAssignmentPlan({...input,maxResources:1,manualMatchIds:['new'],providerCatalog:{providers:{H:{enabled:true}}}});
  assert.deepEqual(explicitReplacement.assignments.map(row=>row.matchId),['new']);
});
