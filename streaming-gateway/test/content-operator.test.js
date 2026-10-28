import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerOperatorConsole } from '../operator-console.js';
import { emptyOperatorState, writeOperatorState } from '../operator-state.js';

async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'content-operator-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { operatorControlPath: join(dir, 'state.json'), providerAccounts: () => ({ A: { enabled: true }, B: { enabled: true }, C: { enabled: true } }) };
  await writeOperatorState(config.operatorControlPath, { ...emptyOperatorState(), channels: { peer: 'unchanged' },
    overrides: { peer: { channel: 'Peer TV', enabled: true, expiresAt: '2099-01-01' } } });
  const installs = [], applied = [];
  const controller = registerOperatorConsole(express(), { config, redis: {}, clientIp: () => '', status: () => ({}),
    getMatches: async () => [{ matchId: 'target', status: 'LIVE' }, { matchId: 'peer', status: 'LIVE' }],
    prepareChannel: () => assert.fail('already verified, never re-probe a watched account'),
    installVerifiedChannel: async value => installs.push(value),
    applyResources: async value => { applied.push(value); if (options.fail) throw new Error('provider_busy'); },
    beginOperation: options.beginOperation });
  const input = { matchId: 'target', channel: 'Correct TV', providerId: 'C', revision: 0,
    content: { status: 'verified' }, guard: () => true,
    result: { resolvedChannel: 'Correct TV', provider_sources: { C: 'https://test.example/correct' } } };
  return { controller, input, installs, applied };
}

test('a content-confirmed transfer updates only its match and requests peer preservation', async t => {
  const { controller, input, installs, applied } = await setup(t);
  assert.equal((await controller.applyVerifiedChannel(input)).status, 'corrected');
  const state = await controller.read();
  assert.equal(installs.length, 1);
  assert.deepEqual(applied, [{ matchId: 'target', preserveUnrelated: true }]);
  assert.equal(state.channels.peer, 'unchanged');
  assert.equal(state.overrides.peer.channel, 'Peer TV');
  assert.equal(state.overrides.target.channel, 'Correct TV');
  assert.equal(state.providers.target.source, 'content-verification');
});

test('stale operator state, an occupied provider, or unknown content prevents any installation', async t => {
  const { controller, input, installs } = await setup(t);
  for (const extra of [{ revision: 10 }, { guard: () => false }, { content: { status: 'pending' } }]) {
    await assert.rejects(controller.applyVerifiedChannel({ ...input, ...extra }), /content_change_obsolete/);
  }
  assert.equal(installs.length, 0);
  assert.equal((await controller.read()).channels.peer, 'unchanged');
});

test('a failed target transfer rolls back its bindings and keeps every peer unchanged', async t => {
  const { controller, input } = await setup(t, { fail: true });
  await assert.rejects(controller.applyVerifiedChannel(input), /provider_busy/);
  const state = await controller.read();
  assert.equal(state.providers.target, undefined); assert.equal(state.overrides.target, undefined);
  assert.equal(state.channels.peer, 'unchanged'); assert.equal(state.overrides.peer.channel, 'Peer TV');
});
