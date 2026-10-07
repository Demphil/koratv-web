import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOperatorConsole } from '../operator-console.js';
import { hashOperatorPassword } from '../operator-auth.js';
import { emptyOperatorState, readOperatorState, writeOperatorState } from '../operator-state.js';
import { createApp } from '../app.js';
import { publicAssignmentMatches, buildProjectAssignmentPlan } from '../scripts/resource-assignment.js';
import { moroccoMatchDay } from '../../shared/operator-imported-match.mjs';

function fixture() {
  const id = 'kooora_manual_unlisted_pair';
  const kickoff = new Date(Date.now() + 4 * 3600000).toISOString();
  return { id, match_id: id, source: 'kooora', home_team: 'Local Alpha', away_team: 'Local Beta', league: 'Regional Exhibition Cup', kickoff_time: kickoff, active: true,
    channel: 'Fixture TV', payload: { status: 'FIXTURE', sourceMatchId: 'fixture-id', channels: ['Fixture TV'],
      broadcast: { source: 'kooora', state: 'assigned', channels: ['Fixture TV'] },
      operatorImport: { source: 'operator-console', matchId: id, sourceMatchId: 'fixture-id', day: moroccoMatchDay(kickoff), importedAt: new Date().toISOString() } } };
}
const redisFor = () => { const data = new Map(); return { get: async key => data.get(key), set: async (key, value) => data.set(key, value), del: async key => data.delete(key), expire: async () => {}, incr: async key => { const value = Number(data.get(key) || 0) + 1; data.set(key, value); return value; } }; };

test('unlisted manually imported fixture passes public display and assignment only for its identity', async t => {
  const row = fixture();
  const unrelated = { ...row, id: 'other', match_id: 'other', payload: { ...row.payload, operatorImport: undefined } };
  assert.deepEqual(publicAssignmentMatches([row, unrelated]).map(row => row.match_id), [row.match_id]);
  const config = { secret: 'test-secret-longer-than-32-characters', hmacSecret: 'independent-hmac-longer-than-32-characters', frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: '', frontendOrigins: new Set(['https://koratv.click']), upstreamOrigins: new Set(), trustedProxies: [], enableAntiBot: false, getMatchesForOrigin: async () => [row, unrelated] };
  const server = createApp({ config, redis: redisFor() }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/matches`);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.matches.map(row => row.matchId), [row.match_id]);
});

test('display-only imports require authentication and CSRF without changing a full broadcast selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'operator-import-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const password = 'local-test-password-for-import';
  const config = { api: '', operatorControlPath: join(dir, 'control.json'), operatorPasswordHash: await hashOperatorPassword(password),
    providerChannels: () => ({ 'Fixture TV': { A: 'private-source' } }), providerAccounts: () => ({ A: { enabled: true } }), resolveOperatorChannel: name => name, refreshMatchSnapshots: async () => {} };
  const row = fixture();
  let imported = false, imports = 0, probes = 0;
  const calls = [];
  const before = { ...emptyOperatorState(), selection: { enabled: true, date: moroccoMatchDay(), matches: Array.from({ length: 8 }, (_, i) => `existing-${i}`), source: 'operator-console' }, overrides: { 'existing-0': { channel: 'Existing TV', enabled: true, expiresAt: new Date(Date.now() + 3600000).toISOString() } } };
  await writeOperatorState(config.operatorControlPath, before);
  const app = express(); app.use(express.json());
  registerOperatorConsole(app, { config, redis: redisFor(), clientIp: () => 'test', status: () => ({}),
    getMatches: async () => [...Array.from({ length: 8 }, (_, i) => ({ matchId: `existing-${i}`, broadcastRank: i + 1 })), ...(imported ? [{ matchId: row.match_id }] : [])],
    matchWorker: async (mode, input) => { if (mode === 'search') return { matches: [row] }; assert.equal(input.sourceMatchId, 'fixture-id'); imported = true; imports++; return { match: row }; },
    prepareChannel: async () => { probes++; throw new Error('Unexpected probe'); }, applyResources: async input => { calls.push(input); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  config.api = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(config.api + '/api/operator/' + path, { method: 'POST', headers: { Origin: config.api, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('matches/search', { homeTeam: 'Local Alpha', awayTeam: 'Local Beta' })).status, 401);
  const login = await post('login', { username: 'admin', password });
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-Operator-CSRF': (await login.json()).csrf };
  assert.equal((await post('matches/search', { homeTeam: 'Local Alpha', awayTeam: 'Local Beta' }, { Cookie: headers.Cookie })).status, 403);
  const results = await (await post('matches/search', { homeTeam: 'Local Alpha', awayTeam: 'Local Beta' }, headers)).json();
  assert.equal(results.matches.length, 1);
  assert.equal(JSON.stringify(results).includes('private-source'), false);
  const invalid = await post('matches/import', { candidateId: 'untrusted-candidate' }, headers);
  const invalidJob = (await invalid.json()).job;
  await new Promise(resolve => setTimeout(resolve, 30));
  let state = await (await fetch(config.api + '/api/operator/state', { headers })).json();
  assert.equal(state.jobs.find(job => job.id === invalidJob.id).error, 'search_expired');
  assert.equal(imports, 0);
  const add = await post('matches/import', { candidateId: results.matches[0].candidateId }, headers);
  const job = (await add.json()).job;
  await new Promise(resolve => setTimeout(resolve, 80));
  state = await (await fetch(config.api + '/api/operator/state', { headers })).json();
  assert.equal(state.jobs.find(item => item.id === job.id).state, 'complete');
  assert.equal(state.jobs.find(item => item.id === job.id).displayOnly, true);
  assert.equal(state.jobs.find(item => item.id === job.id).channel, undefined);
  assert.equal(imports, 1);
  assert.deepEqual(calls, []);
  assert.equal(probes, 0);
  const after = await readOperatorState(config.operatorControlPath);
  assert.deepEqual(after.selection, before.selection);
  assert.deepEqual(after.overrides, before.overrides);
  assert.deepEqual(after.notices, before.notices);
});

test('a display-only exception reserves a provider only after the existing manual selection approves it', () => {
  const row = fixture();
  const input = { matches: [row], routeStates: { [row.match_id]: { status: 'RESOLVED', resolvedChannel: 'Fixture TV', providerIds: ['A'] } }, providerCatalog: { providers: { A: { enabled: true } } }, now: new Date(row.kickoff_time) };
  const automatic = buildProjectAssignmentPlan(input);
  assert.equal(automatic.assignments.length, 0);
  assert.equal(automatic.ignored[0].reason, 'manual_selection_required');
  const selected = buildProjectAssignmentPlan({ ...input, manualMatchIds: [row.match_id] });
  assert.equal(selected.assignments.length, 1);
  assert.equal(selected.assignments[0].manual, true);
  const normal = buildProjectAssignmentPlan({ ...input, matches: [{ ...row, league: 'La Liga' }] });
  assert.equal(normal.assignments.length, 1);
});
