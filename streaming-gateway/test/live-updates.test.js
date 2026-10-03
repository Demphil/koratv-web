import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createApp } from '../app.js';

const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');

test('live unprepared matches start text coverage without tokens or provider traffic', async () => {
  const block = source.slice(source.indexOf('async function prepareLiveUpdates('), source.indexOf('function isAllowedStreamApiUrl('));
  let loads = 0, cards = 0, renders = 0, polls = 0;
  const context = vm.createContext({
    embeddedMatchId: 'exact-match', entry: '', activeMatchId: '', selectedMatchTab: '', matchTimer: null,
    enforceEmbedIntegrity: () => true, notifyParent: () => {}, showLoading: () => {},
    decodeJwtPayload: () => ({}),
    loadMatchPanel: async id => { loads++; assert.equal(id, 'exact-match'); return { matchId: id, playbackState: 'live', sourceReady: false }; },
    renderMatchPanel: () => renders++, showLiveUpdates: () => cards++,
    clearInterval: () => {}, setInterval: (_callback, interval) => { assert.equal(interval, 15000); polls++; },
    fetch: () => { throw new Error('must not create a streaming session'); },
    Hls: { isSupported: () => { throw new Error('text mode needs no HLS support'); } },
  });
  await vm.runInContext(block + ';start()', context);
  assert.equal(loads, 1);
  assert.equal(cards, 1);
  assert.equal(renders, 1);
  assert.equal(polls, 1);
  assert.equal(context.activeMatchId, 'exact-match');
});

test('ready streams and non-live matches do not enter text-only mode', async () => {
  const block = source.slice(source.indexOf('async function prepareLiveUpdates('), source.indexOf('async function start('));
  for (const match of [
    { playbackState: 'live', sourceReady: true },
    { playbackState: 'upcoming', sourceReady: false },
    { playbackState: 'ended', sourceReady: false },
    null,
  ]) {
    const context = { activeMatchId: '', loadMatchPanel: async () => match,
      showLiveUpdates: () => { throw new Error('unexpected text mode'); } };
    assert.equal(await vm.runInNewContext(block + ';prepareLiveUpdates("exact")', context), false);
  }
});

test('both sites open live matches without claiming they have a ready video source', () => {
  for (const file of ['../../assets/js/matches.js', '../../../foottv6/assets/js/matches.js']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(text, /const canOpenSecurePlayer = isLive && !isEnded;/);
    assert.doesNotMatch(text, /sourceReady\s*=\s*true/);
  }
  const css = readFileSync(new URL('../player/player.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /embedded-view\.live-updates-view \.match-panel/);
});

test('match info exposes assignment and text mode without invoking playback resolution', async t => {
  const row = { match_id: 'exact-match', home_team: 'England', away_team: 'Spain', league: 'UEFA Nations League',
    kickoff_time: new Date().toISOString(), source_ready: false, resource_status: 'WAITING',
    payload: { status: 'LIVE', events: [{ minute: 20, player: 'Player', type: 'Card' }] } };
  const config = { enableAntiBot: false, providerPoolEnabled: false,
    secret: 's'.repeat(48), hmacSecret: 'h'.repeat(48), frontend: 'https://koratv.click',
    player: 'https://fabor.sbs', api: 'https://api.example', trustedProxies: [],
    frontendOrigins: new Set(['https://koratv.click']), upstreamOrigins: new Set(),
    getMatchesForOrigin: async () => [row],
    getPlaybackForSource: () => { throw new Error('metadata must not allocate resources'); } };
  const app = createApp({ config, redis: {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/match-info?matchId=exact-match`);
  assert.equal(response.status, 200);
  let { match } = await response.json();
  assert.equal(match.viewingMode, 'live_updates');
  assert.equal(match.resourceStatus, 'WAITING');
  assert.equal(match.sourceReady, false);
  assert.equal(match.events.length, 1);
  row.source_ready = true; row.resource_status = 'ASSIGNED';
  response = await fetch(`${base}/api/match-info?matchId=exact-match`);
  ({ match } = await response.json());
  assert.equal(match.viewingMode, 'stream');
  assert.equal(match.sourceReady, true);
  assert.equal((await fetch(`${base}/api/match-info?matchId=wrong-match`)).status, 404);
});
