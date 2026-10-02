import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssignmentPlan, buildProjectAssignmentPlan, scoreEvent, scoreProjectMatch } from '../scripts/resource-assignment.js';

test('event scoring prioritizes national teams, VIP teams and competition tiers', () => {
  const options = { vipTeams: ['Real Madrid'], tierPoints: { 1: 300, 2: 150, 3: 50 } };
  assert.equal(scoreEvent({ national_team: true, home_team: 'A', away_team: 'B', competition_tier: 1 }, options), 1300);
  assert.equal(scoreEvent({ national_team: false, home_team: 'Real Madrid', away_team: 'B', competition_tier: 2 }, options), 650);
  assert.equal(scoreEvent({ national_team: false, home_team: 'A', away_team: 'B', competition_tier: 3 }, options), 50);
});

test('assignment plan keeps only the highest scoring events within resource capacity', () => {
  const events = [
    { id: 'low', name: 'Low', home_team: 'A', away_team: 'B', competition_tier: 3, start_time: '2026-10-02T20:00:00Z' },
    { id: 'vip', name: 'VIP', home_team: 'Real Madrid', away_team: 'B', competition_tier: 2, start_time: '2026-10-02T21:00:00Z' },
    { id: 'national', name: 'National', national_team: true, home_team: 'A', away_team: 'B', competition_tier: 1, start_time: '2026-10-02T22:00:00Z' },
  ];
  const resources = [
    { id: 'r1', name: 'Worker 1', enabled: true },
    { id: 'r2', name: 'Worker 2', enabled: true },
  ];
  const plan = buildAssignmentPlan({
    events,
    resources,
    maxResources: 2,
    now: new Date('2026-10-02T10:00:00Z'),
    options: { vipTeams: ['Real Madrid'], tierPoints: { 1: 300, 2: 150, 3: 50 } },
  });
  assert.deepEqual(plan.assignments.map((item) => item.event.id), ['national', 'vip']);
  assert.deepEqual(plan.assignments.map((item) => item.resource.id), ['r1', 'r2']);
  assert.deepEqual(plan.ignoredEventIds, ['low']);
});

test('assignment plan ignores disabled resources and uses kickoff as a tie breaker', () => {
  const events = [
    { id: 'late', name: 'Late', competition_tier: 3, start_time: '2026-10-02T22:00:00Z' },
    { id: 'early', name: 'Early', competition_tier: 3, start_time: '2026-10-02T18:00:00Z' },
  ];
  const resources = [
    { id: 'disabled', name: 'Disabled', enabled: false },
    { id: 'r1', name: 'Worker 1', enabled: true },
  ];
  const plan = buildAssignmentPlan({
    events,
    resources,
    maxResources: 8,
    options: { tierPoints: { 3: 50 } },
  });
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].event.id, 'early');
  assert.equal(plan.assignments[0].resource.id, 'r1');
  assert.deepEqual(plan.ignoredEventIds, ['late']);
});

test('project assignment uses resolved route state and never assigns more than available providers', () => {
  const matches = [
    { id: 'm-low', match_id: 'm-low', home_team: 'A', away_team: 'B', league: 'Minor', kickoff_time: '2026-10-02T18:00:00Z' },
    { id: 'm-vip', match_id: 'm-vip', home_team: 'Real Madrid', away_team: 'B', league: 'Friendly', kickoff_time: '2026-10-02T19:00:00Z' },
    { id: 'm-national', match_id: 'm-national', home_team: 'Morocco', away_team: 'B', league: 'Friendly', kickoff_time: '2026-10-02T20:00:00Z',
      payload: { national_team: true } },
  ];
  const routeStates = {
    'm-low': { status: 'RESOLVED', resolvedChannel: 'Channel Low', requestedChannel: 'Channel Low', providerIds: ['A'] },
    'm-vip': { status: 'RESOLVED', resolvedChannel: 'Channel VIP', requestedChannel: 'Channel VIP', providerIds: ['A', 'B'] },
    'm-national': { status: 'RESOLVED', resolvedChannel: 'Channel National', requestedChannel: 'Channel National', providerIds: ['B'] },
  };
  const providerCatalog = { providers: { A: { enabled: true }, B: { enabled: true }, C: { enabled: false } } };
  const plan = buildProjectAssignmentPlan({
    matches,
    routeStates,
    providerCatalog,
    maxResources: 2,
    now: new Date('2026-10-02T10:00:00Z'),
    options: { vipTeams: ['Real Madrid'], tierPoints: { 1: 300, 2: 150, 3: 50 } },
  });
  assert.equal(scoreProjectMatch(matches[2], 'Channel National', { vipTeams: ['Real Madrid'] }) > scoreProjectMatch(matches[1], 'Channel VIP', { vipTeams: ['Real Madrid'] }), true);
  assert.deepEqual(plan.assignments.map((item) => [item.matchId, item.providerId]), [['m-national', 'B'], ['m-vip', 'A']]);
  assert.deepEqual(plan.ignored.map((item) => item.matchId), ['m-low']);
  assert.equal(JSON.stringify(plan).includes('https://'), false);
});
