import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballClient } from '../scripts/api-football-client.mjs';

const options = { key: 'private-test-only', baseUrl: 'https://v3.football.api-sports.io', minIntervalMs: 0, sleep: async () => {} };
test('API client retries bounded transient errors and handles provider error objects on HTTP 200', async () => {
  let calls = 0;
  const client = createApiFootballClient({ ...options, fetchImpl: async (_, init) => {
    assert.ok(init.signal);
    assert.equal(init.headers['x-apisports-key'], options.key);
    calls++;
    return new Response(JSON.stringify(calls === 1 ? { errors: { rateLimit: 'slow down' } } : { response: [42] }));
  } });
  assert.deepEqual(await client.request('/fixtures', { ids: '42' }), [42]);
  assert.equal(calls, 2);
});
test('authentication failure is not retried and daily quota stops subsequent requests', async () => {
  let calls = 0;
  const denied = createApiFootballClient({ ...options, fetchImpl: async () => { calls++; return new Response('{}', { status: 401 }); } });
  await assert.rejects(denied.request('/fixtures'), /401/);
  assert.equal(calls, 1);
  const exhausted = createApiFootballClient({ ...options, fetchImpl: async () => { calls++; return new Response('{"response":[]}', { headers: { 'x-ratelimit-requests-remaining': '0' } }); } });
  await exhausted.request('/fixtures');
  await assert.rejects(exhausted.request('/leagues'), /quota exhausted/);
  assert.equal(calls, 2);
});
test('concurrent API calls are serialized and malformed replies cannot become authoritative emptiness', async () => {
  let active = 0, peak = 0;
  const client = createApiFootballClient({ ...options, fetchImpl: async () => {
    active++; peak = Math.max(active, peak);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return new Response('{"response":[]}');
  } });
  await Promise.all([client.request('/fixtures'), client.request('/leagues')]);
  assert.equal(peak, 1);
  const malformed = createApiFootballClient({ ...options, fetchImpl: async () => new Response('{"results":0}') });
  await assert.rejects(malformed.request('/fixtures'), /invalid_response/);
});
