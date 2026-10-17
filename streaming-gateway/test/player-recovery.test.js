import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('async function recoverStream('), source.indexOf('function scheduleReconnect('));

test('a viewer waits for a verified replacement then reconnects the same match without navigation', async () => {
  let ready = false, connected = 0, polls = 0;
  const timers = [];
  const context = vm.createContext({ liveUpdatesMode: false, recoveringStream: false, recoveryPolls: 0, activeMatchId: 'exact',
    loadTimer: 1, retryTimer: 2, qualityStallTimer: 3, stallRecoveryTimer: 4, expiryTimer: 5,
    hls: { stopLoad: () => {} }, clearTimeout: () => {}, showLoading: () => {},
    loadMatchPanel: async id => { assert.equal(id, 'exact'); polls++; return { sourceReady: ready, playbackState: 'live' }; },
    hlsSessionToken: 'same-protected-session', sessionExpiresAt: Date.now() + 60000,
    connectStream: attempt => { assert.equal(attempt, 0); connected++; },
    setTimeout: (callback, delay) => { assert.ok(delay >= 3000); timers.push(callback); return 1; },
    location: { reload: () => { throw new Error('must not reload the page'); } },
  });
  await vm.runInContext(block + ';recoverStream()', context);
  assert.equal(connected, 0); assert.equal(timers.length, 1);
  ready = true; await timers.shift()();
  assert.equal(connected, 1); assert.equal(polls, 2);
  assert.equal(context.activeMatchId, 'exact'); assert.equal(context.recoveringStream, false);
});

test('automatic recovery renews an expired session but respects a manual stop', async () => {
  let starts = 0;
  const context = vm.createContext({ liveUpdatesMode: false, recoveringStream: false, recoveryPolls: 0, activeMatchId: 'exact',
    loadTimer: 1, retryTimer: 2, qualityStallTimer: 3, stallRecoveryTimer: 4, expiryTimer: 5,
    hls: { stopLoad: () => {} }, clearTimeout: () => {}, showLoading: () => {}, hlsSessionToken: '', sessionExpiresAt: 0,
    loadMatchPanel: async () => ({ sourceReady: true }), start: async options => { assert.equal(options.forceNewSession, true); assert.equal(options.recovery, true); starts++; },
    connectStream: () => { throw new Error('expired token must not be reused'); },
    setTimeout: () => { throw new Error('no extra timer after success or a manual stop'); },
  });
  await vm.runInContext(block + ';recoverStream()', context);
  assert.equal(starts, 1);
  context.loadMatchPanel = async () => { context.liveUpdatesMode = true; return { sourceReady: false, resourceStatus: 'PAUSED' }; };
  await vm.runInContext('recoverStream()', context);
  assert.equal(starts, 1);
});

test('the resume button submits its channel and provider without automatic takeover', () => {
  const ui = readFileSync(new URL('../operator/console.js', import.meta.url), 'utf8');
  const toggle = ui.slice(ui.indexOf("const toggle = button('square'"), ui.indexOf("toggle.className ="));
  assert.match(toggle, /current.paused \? 'channel'/);
  assert.match(toggle, /resume: true, channel: input.value/);
  assert.match(toggle, /providerId: provider.value/);
  assert.match(toggle, /assigned.size >=/);
  assert.doesNotMatch(toggle, /takeover: true/);
});

test('operator resume leaves statistics-only mode and restarts just that player', async () => {
  const refresh = source.slice(source.indexOf('let operatorRefreshRunning ='), source.indexOf("refreshStreamButton?.addEventListener('click'"));
  let starts = 0;
  const classes = [];
  const context = vm.createContext({ window: {}, activeMatchId: 'exact', video: { paused: true }, resumeAfterAdminStop: true,
    expiryTimer: 1, matchTimer: 2, poolHeartbeatTimer: 3, retryTimer: 4, loadTimer: 5, hls: { destroy: () => {} },
    clearTimeout: () => {}, clearInterval: () => {}, sessionStorage: { removeItem: () => {} }, sessionKey: 'test',
    loadMatchPanel: async () => ({ sourceReady: true, playbackState: 'live' }),
    liveUpdatesMode: true, liveUpdatesSignature: 'old', resumePlayback: false, playbackProgressTimer: null,
    document: { documentElement: { classList: { remove: name => classes.push(name) } } },
    status: { classList: { remove: name => classes.push(name) } }, refreshStreamButton: { hidden: true },
    start: async options => { assert.equal(options.forceNewSession, true); starts++; },
    setInterval: () => 10, checkPlaybackProgress: () => {},
    setTimeout: () => { throw new Error('ready resume must not keep retrying'); }, showLoading: () => {},
  });
  await vm.runInContext(refresh + ';window.refreshOperatorPlayback()', context);
  assert.equal(starts, 1);
  assert.equal(context.liveUpdatesMode, false);
  assert.equal(context.resumePlayback, true);
  assert.equal(context.refreshStreamButton.hidden, false);
  assert.deepEqual(classes, ['live-updates-view', 'live-updates-state']);
});
