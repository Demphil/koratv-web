import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { isAllowedLeague } from '../../shared/league-whitelist.mjs';

const valid = {
  JWT_SECRET: 'j'.repeat(48),
  HMAC_SECRET: 'h'.repeat(48),
  PUBLIC_API_ORIGIN: 'https://stream-api.koratv.click',
  FRONTEND_ORIGIN: 'https://koratv.click',
  PLAYER_ORIGIN: 'https://medic.cymru',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test-key',
  STREAM_SESSION_TTL_SECONDS: '7200',
  UPSTREAM_ORIGINS: 'https://media.example.com'
};

test('configuration accepts independent secrets and HTTPS origins', () => {
  const config = loadConfig(valid);
  assert.equal(config.api, valid.PUBLIC_API_ORIGIN);
  assert.equal(config.enableAntiBot, true);
  assert.equal(loadConfig({ ...valid, ENABLE_ANTI_BOT: 'false' }).enableAntiBot, false);
  assert.equal(config.sessionTtl, 7200);
  assert.equal(config.upstreamUserAgent, 'VLC/3.0.20 LibVLC/3.0.20');
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

test('league whitelist admits requested competitions and rejects lower divisions', () => {
  assert.equal(isAllowedLeague('دوري أبطال أوروبا للسيدات'), true);
  assert.equal(isAllowedLeague('الدوري الإنجليزي الممتاز للسيدات'), false);
  assert.equal(isAllowedLeague('البطولة الوطنية الاحترافية المغربية'), false);
  assert.equal(isAllowedLeague('دوري أبطال أفريقيا'), true);
  assert.equal(isAllowedLeague('الدوري الإيطالي الدرجة الثالثة'), false);
  assert.equal(isAllowedLeague('الدوري المكسيكي الممتاز'), false);
});
