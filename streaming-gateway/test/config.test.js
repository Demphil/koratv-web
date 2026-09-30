import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, sourceForMatchId } from '../config.js';
import { isAllowedLeague, isGulfCupLeague } from '../../shared/league-whitelist.mjs';

const valid = {
  JWT_SECRET: 'j'.repeat(48),
  HMAC_SECRET: 'h'.repeat(48),
  PUBLIC_API_ORIGIN: 'https://stream-api.koratv.click',
  FRONTEND_ORIGIN: 'https://koratv.click',
  FRONTEND_ORIGINS: 'https://frajatv.fun,https://www.frajatv.fun,https://fraja.online,https://koratv.click,https://www.koratv.click',
  PLAYER_ORIGIN: 'https://fabor.sbs',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test-key',
  STREAM_SESSION_TTL_SECONDS: '7200',
  UPSTREAM_ORIGINS: 'https://media.example.com'
};

test('configuration accepts independent secrets and HTTPS origins', () => {
  const config = loadConfig(valid);
  assert.equal(config.api, valid.PUBLIC_API_ORIGIN);
  assert.ok(config.frontendOrigins.has('https://frajatv.fun'));
  assert.ok(config.frontendOrigins.has('https://koratv.click'));
  assert.equal(config.enableAntiBot, true);
  assert.equal(loadConfig({ ...valid, ENABLE_ANTI_BOT: 'false' }).enableAntiBot, false);
  assert.equal(config.sessionTtl, 7200);
  assert.equal(config.upstreamUserAgent, 'IPTVSmartersPlayer');
  assert.ok(config.upstreamOrigins.has('https://media.example.com'));
});

test('stream sessions default to a long live-match window', () => {
  const { STREAM_SESSION_TTL_SECONDS, ...withoutTtl } = valid;
  assert.equal(loadConfig(withoutTtl).sessionTtl, 10800);
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

test('match identifiers pin player metadata to their originating feed', () => {
  assert.equal(sourceForMatchId('api-football_2026-09-26_england_vs_spain'), 'api-football');
  assert.equal(sourceForMatchId('kooora_2026-09-26_england_vs_spain'), 'kooora');
  assert.equal(sourceForMatchId('legacy-match-id'), '');
});

test('Kora feed keeps Kooora primary and adds only allowed Gulf Cup API fixtures', async () => {
  const originalFetch = globalThis.fetch;
  const matchSourceFilters = [];
  const apiFixtures = [
    { id: 'api-football-gulf', match_id: 'api-football-gulf', home_team: 'Bahrain', away_team: 'Yemen', league: 'Gulf Cup of Nations', kickoff_time: '2026-09-30T17:30:00Z', source: 'api-football', active: true, payload: {} },
    { id: 'api-football-other', match_id: 'api-football-other', home_team: 'Arsenal', away_team: 'Chelsea', league: 'Premier League', kickoff_time: '2026-09-30T17:30:00Z', source: 'api-football', active: true, payload: {} },
    { id: 'api-football-women', match_id: 'api-football-women', home_team: 'Bahrain Women', away_team: 'Yemen Women', league: 'Gulf Cup of Nations', kickoff_time: '2026-09-30T17:30:00Z', source: 'api-football', active: true, payload: {} },
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/matches')) {
      const source = url.searchParams.get('source') || '';
      matchSourceFilters.push(source);
      return new Response(JSON.stringify(source === 'in.(api-football)' ? apiFixtures : []), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  };
  try {
    const rows = await loadConfig(valid).getMatchesForOrigin('https://koratv.click');
    assert.deepEqual(matchSourceFilters.sort(), ['in.(api-football)', 'in.(kooora)']);
    assert.deepEqual(rows.map(row => row.match_id), ['api-football-gulf']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Kooora-origin playback follows an API-Football match identifier', async () => {
  const originalFetch = globalThis.fetch;
  const matchSourceFilters = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/matches')) {
      matchSourceFilters.push(url.searchParams.get('source') || '');
      return new Response(JSON.stringify([{
        id: 'api-football_2026-09-30_bahrain_vs_yemen', match_id: 'api-football_2026-09-30_bahrain_vs_yemen', home_team: 'Bahrain', away_team: 'Yemen',
        league: 'Gulf Cup of Nations', kickoff_time: new Date().toISOString(), source: 'api-football', active: true, payload: {}
      }]), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await loadConfig(valid).getPlaybackForSource('kooora', 'api-football_2026-09-30_bahrain_vs_yemen');
    assert.equal(result.reason, 'channel_unavailable');
    assert.deepEqual(matchSourceFilters, ['in.(api-football)']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('league whitelist admits requested competitions and rejects lower divisions', () => {
  assert.equal(isGulfCupLeague('Gulf Cup of Nations'), true);
  assert.equal(isGulfCupLeague('كأس الخليج العربي'), true);
  assert.equal(isGulfCupLeague("Women's Gulf Cup"), false);
  assert.equal(isAllowedLeague('دوري أبطال أوروبا للسيدات'), false);
  assert.equal(isAllowedLeague("UEFA Women's Champions League"), false);
  assert.equal(isAllowedLeague('الدوري الإنجليزي الممتاز للسيدات'), false);
  assert.equal(isAllowedLeague('البطولة الوطنية الاحترافية المغربية'), true);
  assert.equal(isAllowedLeague('دوري أبطال أفريقيا'), true);
  assert.equal(isAllowedLeague('الدوري الإيطالي الدرجة الثالثة'), false);
  assert.equal(isAllowedLeague('الدوري المكسيكي الممتاز'), false);
});
