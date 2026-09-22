import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('playback ticket preserves Arabic match identifiers', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const start = source.indexOf('function decodeJwtPayload(');
  const end = source.indexOf('function cardTotal(', start);
  const matchId = 'إنتر_vs_هاكين_للسيدات';
  const token = `header.${Buffer.from(JSON.stringify({ matchId })).toString('base64url')}.signature`;
  const result = vm.runInNewContext(`${source.slice(start, end)}; decodeJwtPayload(token)`, { token, atob, TextDecoder, Uint8Array });
  assert.equal(result.matchId, matchId);
});

test('standalone player does not depend on sidebar visibility or viewport size', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const start = source.indexOf('function isFramed()');
  const end = source.indexOf('function enforceEmbedIntegrity()', start);
  const window = { innerWidth: 280, innerHeight: 300 };
  window.self = window.top = window;
  assert.equal(vm.runInNewContext(`${source.slice(start, end)}; embedIntegrityOk()`, { window }), true);
});

test('match opens a tab before token fetch and preserves the original page', async () => {
  const source = readFileSync(new URL('../../assets/js/matches.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function openSecurePlayer(');
  const end = source.indexOf('function setupSecurePlayerLinks()', start);
  const events = [];
  const tab = {
    document: { body: {}, documentElement: {} },
    location: { replace: (url) => events.push(url) },
    close: () => events.push('close'),
  };
  const window = {
    location: { href: 'https://koratv.click/' },
    open: () => { events.push('open'); return tab; },
  };
  await vm.runInNewContext(`${source.slice(start, end)}; openSecurePlayer('match-1')`, {
    window, STREAM_API_ORIGIN: 'https://stream-api.koratv.click',
    PLAYER_ORIGIN: 'https://medic.cymru', PLAYER_PATH: '/739184.html',
    fetch: async () => {
      events.push('fetch');
      return { ok: true, json: async () => ({ token: 'test-ticket' }) };
    },
  });
  assert.deepEqual(events, ['open', 'fetch', 'https://medic.cymru/739184.html?k=test-ticket']);
  assert.equal(window.location.href, 'https://koratv.click/');
  assert.equal(tab.opener, null);
});
