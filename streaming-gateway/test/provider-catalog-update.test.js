import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderDiscovery } from '../provider-catalog-update.js';

const credentials = { username: 'test-account', password: 'not-used' };
const origins = ['https://provider.example'];
const checkedAt = '2026-09-29T12:00:00.000Z';
const oldUrl = 'https://provider.example/live/old.m3u8';
const newUrl = 'https://provider.example/live/new.m3u8';

function catalog() {
  return {
    providers: { A: { id: 'Account_1_Primary', username: credentials.username, enabled: true, sourceUrl: oldUrl } },
    channels: { 'Test One': { A: oldUrl, B: 'https://other.example/live/one.m3u8', sourceNames: { A: 'Old One' } } },
  };
}

test('transient catalog failure retains the previous link and enabled account', () => {
  const current = catalog();
  const result = applyProviderDiscovery(current, 'A', credentials, origins,
    { selected: [], attempts: [{ error: 'timeout' }] }, checkedAt);
  assert.equal(result.retained, true);
  assert.equal(current.channels['Test One'].A, oldUrl);
  assert.equal(current.providers.A.enabled, true);
  assert.equal(current.providers.A.syncStatus, 'STALE');
});

test('provider expiry disables distribution without deleting the last catalog', () => {
  const current = catalog();
  applyProviderDiscovery(current, 'A', credentials, origins,
    { selected: [], info: { status: 'Expired' } }, checkedAt);
  assert.equal(current.providers.A.enabled, false);
  assert.equal(current.channels['Test One'].A, oldUrl);
});

test('an account reporting zero permitted connections is not enabled', () => {
  const current = catalog();
  applyProviderDiscovery(current, 'A', credentials, origins,
    { selected: [{ name: 'Test Two', chosen: { original_url: newUrl, source_name: 'New Two' } }],
      info: { status: 'Active', max_connections: 0 } }, checkedAt);
  assert.equal(current.providers.A.enabled, false);
  assert.equal(current.channels['Test One'].A, oldUrl);
  assert.equal(current.channels['Test Two'], undefined);
});

test('a refreshed catalog replaces old links and keeps other providers', () => {
  const current = catalog();
  const result = applyProviderDiscovery(current, 'A', credentials, origins, {
    origin: origins[0], info: { status: 'Active', max_connections: 1 },
    selected: [{ name: 'Test Two', chosen: { original_url: newUrl, source_name: 'New Two' } }],
  }, checkedAt);
  assert.equal(result.replaced, 1);
  assert.equal(current.channels['Test One'].A, undefined);
  assert.equal(current.channels['Test One'].B, 'https://other.example/live/one.m3u8');
  assert.equal(current.channels['Test Two'].A, newUrl);
  assert.equal(current.providers.A.sourceUrl, newUrl);
  assert.equal(current.providers.A.id, 'Account_1_Primary');
});

test('a failed replacement account does not inherit the previous account lease', () => {
  const current = catalog();
  applyProviderDiscovery(current, 'A', { username: 'replacement' }, origins,
    { selected: [], attempts: [{ error: 'timeout' }] }, checkedAt);
  assert.equal(current.providers.A.enabled, false);
});
