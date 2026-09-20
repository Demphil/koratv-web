import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';

const valid = {
  JWT_SECRET: 'j'.repeat(48),
  HMAC_SECRET: 'h'.repeat(48),
  PUBLIC_API_ORIGIN: 'https://stream-api.koratv.click',
  FRONTEND_ORIGIN: 'https://koratv.click',
  PLAYER_ORIGIN: 'https://medic.cymru',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test-key',
  UPSTREAM_ORIGINS: 'https://media.example.com'
};

test('configuration accepts independent secrets and HTTPS origins', () => {
  const config = loadConfig(valid);
  assert.equal(config.api, valid.PUBLIC_API_ORIGIN);
  assert.ok(config.upstreamOrigins.has('https://media.example.com'));
});

test('configuration identifies the unsafe origin variable', () => {
  assert.throws(() => loadConfig({ ...valid, PUBLIC_API_ORIGIN: 'http://127.0.0.1:3100' }), /PUBLIC_API_ORIGIN must use HTTPS/);
  assert.ok(
    loadConfig({
      ...valid,
      UPSTREAM_ORIGINS: 'http://media.example.com'
    }).upstreamOrigins.has('http://media.example.com')
  );
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        UPSTREAM_ORIGINS: 'http://user:password@media.example.com'
      }),
    /without credentials/
  );
});
