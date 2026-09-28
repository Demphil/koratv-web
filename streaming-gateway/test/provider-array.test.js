import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderArray } from '../provider-array.js';

test('provider catalog list retries malformed responses and accepts the next array', async () => {
  let calls = 0;
  const result = await fetchProviderArray(async () => ++calls === 1 ? { error: 'temporarily unavailable' } : [{ category_id: 1 }],
    { username: 'test' }, 'https://provider.example', 'get_live_categories', { delay: async () => {} });
  assert.deepEqual(result, [{ category_id: 1 }]);
  assert.equal(calls, 2);
});

test('provider catalog list gives up safely after invalid replies', async () => {
  let calls = 0;
  const result = await fetchProviderArray(async () => { calls++; return { data: [] }; }, {}, 'https://provider.example', 'get_live_streams', { delay: async () => {} });
  assert.equal(result, null);
  assert.equal(calls, 3);
});
