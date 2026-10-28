import test from 'node:test';
import assert from 'node:assert/strict';
import { assessContentActivation } from '../content-activation.js';

test('activation is deferred for real viewers and cannot mistake stale prewarm records for synthetic viewers', () => {
  const now = Date.now(), checkedAt = new Date(now).toISOString();
  const health = { status: 'ok', providerPool: [{ provider: 'A', channel: 'TV', viewers: 2 }],
    providerPrewarm: { lastRunAt: checkedAt, running: false, results: [{ matchId: 'match', provider: 'A', channel: 'TV', ok: true, checkedAt }] } };
  assert.equal(assessContentActivation(health, now).safe, false);
  health.providerPool[0].viewers = 1;
  assert.equal(assessContentActivation(health, now).safe, true);
  assert.equal(assessContentActivation(health, now + 100_000).safe, false);
  health.providerPrewarm.running = true;
  assert.equal(assessContentActivation(health, now).safe, false);
  assert.equal(assessContentActivation({ status: 'ok', providerPool: [] }, now).safe, true);
  assert.equal(assessContentActivation({ status: 'unavailable' }, now).safe, false);
});
