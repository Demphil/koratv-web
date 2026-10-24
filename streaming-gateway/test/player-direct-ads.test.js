import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('player embeds direct Monetag ads and local cooldown logic in the page', () => {
  const html = readFileSync(new URL('../player/player.html', import.meta.url), 'utf8');
  assert.match(html, /https:\/\/nap5k\.com\/tag\.min\.js/);
  assert.match(html, /https:\/\/n6wxm\.com\/vignette\.min\.js/);
  assert.match(html, /https:\/\/omg10\.com\/4\/11949902/);
  assert.match(html, /zone: '11949898', src: 'https:\/\/al5sm\.com\/tag\.min\.js'/);
  assert.match(html, /addEventListener\('playing', startMonetagAfterPlayback\)/);
  assert.match(html, /AD_COOLDOWN_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(html, /dataset.koratvMonetag/);
  assert.doesNotMatch(html, /AD_START_DELAY_MS|ad-click-shield|removeMonetagScripts|\?kt=/);
  assert.doesNotMatch(html, /ads-controller\.js|ads-config\.json|ad-frame\.html|profitablerate|quge5/);
});

function adsHarness({ mobile = false, embedded = false } = {}) {
  const html = readFileSync(new URL('../player/player.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const handlers = {}, windowHandlers = {}, tags = [], popups = [], events = [];
  let clock = 0, updates = false;
  const video = { paused: true, addEventListener: (name, handler) => { handlers[name] = handler; } };
  const container = { addEventListener: (name, handler) => { handlers[name] = handler; } };
  const win = { open: (...args) => popups.push(args), matchMedia: () => ({ matches: mobile }),
    addEventListener: (name, handler) => { windowHandlers[name] = handler; }, dispatchEvent: event => events.push(event) };
  win.self = win; win.top = embedded ? {} : win;
  vm.runInNewContext(script, {
    document: { getElementById: id => id === 'video' ? video : container,
      documentElement: { classList: { contains: () => updates } },
      createElement: () => ({ dataset: {}, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; }, remove() { this.removed = true; } }),
      querySelectorAll: () => tags.filter(tag => !tag.removed), body: { appendChild: tag => tags.push(tag) } },
    performance: { now: () => clock }, window: win, navigator: { userActivation: { isActive: true } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  return { handlers, windowHandlers, tags, popups, events, video, time: value => { clock = value; }, updates: value => { updates = value; },
    click: (trusted = true, play = true) => handlers.click({ isTrusted: trusted, target: { closest: () => play ? {} : null } }) };
}

test('ads start on real Play gesture without interrupting it, tags wait for playback', () => {
  const h = adsHarness();
  h.click(false);
  h.click(true, false);
  assert.equal(h.popups.length, 0);
  h.click();
  assert.equal(h.popups.length, 1);
  assert.equal(h.tags.length, 0);
  h.video.paused = false;
  h.handlers.playing();
  h.handlers.playing();
  assert.equal(h.tags.length, 3, 'recovery must not install duplicate ad SDK listeners');
  assert.deepEqual(h.tags.map(tag => tag.src), ['https://nap5k.com/tag.min.js', 'https://n6wxm.com/vignette.min.js', 'https://al5sm.com/tag.min.js']);
  assert.equal(h.popups[0][0], 'https://omg10.com/4/11949902');
});

test('mobile and embedded playback keep full-page vignette overlays off the video', () => {
  for (const options of [{mobile:true},{embedded:true}]) {
    const h = adsHarness(options); h.click(); h.video.paused=false; h.handlers.playing();
    assert.equal(h.popups.length,1);
    assert.equal(h.tags.length,2);
    assert.equal(h.tags[0].src,'https://nap5k.com/tag.min.js');
    assert.equal(h.tags[1].dataset.zone, '11949898');
  }
});

test('click ads observe five minute cooldown and never open on text coverage', () => {
  const h = adsHarness();
  h.click();
  h.time(299999); h.click();
  assert.equal(h.popups.length, 1);
  h.time(300000); h.click();
  assert.equal(h.popups.length, 2);
  h.time(600000); h.updates(true); h.click(); h.handlers.playing();
  assert.equal(h.popups.length, 2);
  assert.equal(h.tags.length, 0);
});
test('actual SDK load results are reported without extra requests or reinstalling successful tags', () => {
  const h = adsHarness(); h.video.paused = false; h.handlers.playing();
  h.tags[0].listeners.load(); h.tags[1].listeners.load(); h.tags[2].listeners.error();
  assert.equal(h.tags[0].dataset.supportState, 'ready');
  assert.equal(h.tags[2].dataset.supportState, 'failed');
  assert.equal(h.events.length, 3);
  assert.equal(h.tags.length, 3);
  h.windowHandlers['watch-support-retry']({ detail: { userGesture: false } });
  assert.equal(h.tags.length, 3);
  h.windowHandlers['watch-support-retry']({ detail: { userGesture: true } });
  assert.equal(h.tags.length, 4);
  assert.equal(h.tags[2].removed, true);
  assert.equal(h.tags[3].dataset.zone, '11949898');
  assert.equal(h.tags[0].removed, undefined);
  assert.equal(h.tags[1].removed, undefined);
  h.tags[3].listeners.error();
  h.windowHandlers['watch-support-retry']({ detail: { userGesture: true } });
  assert.equal(h.tags.length, 4, 'failed retries are rate limited');
  h.time(5000); h.windowHandlers['watch-support-retry']({ detail: { userGesture: true } });
  assert.equal(h.tags.length, 5);
  assert.equal(h.popups.length, 0);
});

test('player CSP allows only the direct ad script hosts requested by the page', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /script-src 'self' 'unsafe-inline' https:\/\/nap5k\.com https:\/\/n6wxm\.com/);

  for (const file of ['nginx.conf.example', 'nginx.http-player.conf.example', 'nginx.oracle.conf.example']) {
    const nginx = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(nginx, /script-src 'self' 'unsafe-inline' https:\/\/nap5k\.com https:\/\/n6wxm\.com/);
    assert.match(nginx, /frame-src 'self' https:/);
    assert.match(nginx, /https:\/\/al5sm\.com/);
    assert.doesNotMatch(nginx, /location = \/ad-frame\.html|sandbox allow-scripts|profitablerate|quge5/);
  }
});

test('routine data refresh cannot redeploy the player, restart streaming or overwrite nginx', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/sync-data.yml', import.meta.url), 'utf8');
  assert.match(workflow, /needs: metadata/);
  assert.match(workflow, /prune:matches/);
  assert.doesNotMatch(workflow, /pm2|nginx\.conf|deploy-player|rsync|scp-action|ssh-action/);
});
