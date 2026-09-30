import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('public embed URLs carry match identity, never the current viewer ticket', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function embedSrc()'), source.indexOf('function openEmbedModal()'));
  const code = vm.runInNewContext(`${block}; iframeCode()`, {
    activeMatchId: 'kooora_المغرب_vs_فرنسا', embeddedMatchId: '', entry: 'private-token',
    window: { location: { origin: 'https://fabor.sbs' } }, URL,
  });
  assert.match(code, /watch\.html\?match=/);
  assert.doesNotMatch(code, /private-token|[?&]k=/);
  assert.equal(new URL(code.match(/src="([^"]+)"/)[1]).searchParams.get('match'), 'kooora_المغرب_vs_فرنسا');
});

test('public frames are allowed without relaxing the token issuer origin boundary', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const playerPolicy = app.match(/const playerDocumentCsp = `([^`]+)`/)[1];
  assert.doesNotMatch(playerPolicy, /frame-ancestors/);
  for (const file of ['nginx.conf.example', 'nginx.http-player.conf.example', 'nginx.oracle.conf.example']) {
    const nginx = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const policies = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)];
    assert.ok(policies.length >= 2);
    for (const [, policy] of policies) assert.doesNotMatch(policy, /frame-ancestors/);
    assert.doesNotMatch(nginx, /add_header\s+X-Frame-Options/i);
  }
  assert.match(app, /requireOrigin\(req, tokenOrigins\)/);
  const player = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  assert.match(player, /createSessionForMatch\(embeddedMatchId\)/);
  assert.match(player, /isUsableSession\(stored, embeddedMatchId\)/);
});

test('session recovery never selects an arbitrary live match', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /recoverLiveSession|find\(\(item\) => item\.isLive/);
  assert.match(source, /createSessionForMatch\(session\.matchId\)/);
});

test('today lists never admit yesterday matches', () => {
  for (const file of ['../../assets/js/api.js', '../../assets/js/matches.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /day === 'yesterday' && match\.playbackState/);
  }
});

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

test('HLS accepts the player and resource API origins but rejects other hosts', () => {
  const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
  const start = source.indexOf('function isAllowedStreamApiUrl(');
  const end = source.indexOf('\nfunction hlsOptions()', start);
  const allowed = new Set(['https://fabor.sbs', 'https://stream-api.koratv.click']);
  const isAllowed = (url) => vm.runInNewContext(`${source.slice(start, end)}; isAllowedStreamApiUrl(url)`, {
    STREAM_API_ORIGINS: allowed, URL, url,
  });
  assert.equal(isAllowed('https://fabor.sbs/api/stream.m3u8'), true);
  assert.equal(isAllowed('https://stream-api.koratv.click/api/resource?resource=x'), true);
  assert.equal(isAllowed('https://untrusted.example/api/resource'), false);
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
    PLAYER_ORIGIN: 'https://fabor.sbs', PLAYER_PATH: '/739184.html',
    fetch: async () => {
      events.push('fetch');
      return { ok: true, json: async () => ({ token: 'test-ticket' }) };
    },
  });
  assert.deepEqual(events, ['open', 'fetch', 'https://fabor.sbs/739184.html?k=test-ticket']);
  assert.equal(window.location.href, 'https://koratv.click/');
  assert.equal(tab.opener, null);
});

test('token conflicts fall back to the public player route instead of blocking navigation', async () => {
  const source = readFileSync(new URL('../../assets/js/matches.js', import.meta.url), 'utf8');
  const start = source.indexOf('function opaqueWatchId(');
  const end = source.indexOf('function setupSecurePlayerLinks()', start);
  const events = [];
  const tab = {
    closed: false,
    document: { body: {}, documentElement: {} },
    location: { replace: (url) => events.push(url) },
    close: () => events.push('close'),
  };
  const window = {
    location: { href: 'https://koratv.click/' },
    open: () => { events.push('open'); return tab; },
    closeWaitModal: () => events.push('close-modal'),
    openWaitModal: () => events.push('open-modal'),
  };
  await vm.runInNewContext(`${source.slice(start, end)}; openSecurePlayer('match-1', 'https://fabor.sbs/739184.html?m=public-id')`, {
    window, STREAM_API_ORIGIN: 'https://stream-api.koratv.click',
    PLAYER_ORIGIN: 'https://fabor.sbs', PLAYER_PATH: '/739184.html',
    fetch: async () => {
      events.push('fetch');
      return { ok: false, status: 409, json: async () => ({ error: 'source_unavailable' }) };
    },
    encodeURIComponent,
  });
  assert.deepEqual(events, ['open', 'open-modal', 'fetch', 'close-modal', 'https://fabor.sbs/739184.html?m=public-id']);
  assert.equal(window.location.href, 'https://koratv.click/');
});
