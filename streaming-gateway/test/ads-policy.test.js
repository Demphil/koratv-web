import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adDecision, consumeAd, httpsUrl, STORAGE_KEY } from '../player/ads-policy.js';

const config = {
  enabled: true, click_cooldown_minutes: 20, max_ads_per_session: 2, session_window_minutes: 360,
  click: { enabled: true, providers: [{ enabled: true, url: 'https://ads.example/ad' }] },
};
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
}
test('ad cooldown survives page changes; shared session cap survives channel changes', () => {
  const state = storage();
  const now = 100000000;
  assert.equal(consumeAd(state, config, now), 'https://ads.example/ad');
  assert.equal(consumeAd(state, config, now + 1199999), null);
  assert.equal(consumeAd(state, config, now + 1200000), 'https://ads.example/ad');
  assert.equal(consumeAd(state, config, now + 2400000), null);
  assert.equal(consumeAd(state, config, now + 360 * 60000), 'https://ads.example/ad');
});
test('disabled, exhausted, corrupt or unavailable storage fails closed for ads', () => {
  assert.equal(adDecision({ ...config, enabled: false }, null).eligible, false);
  assert.equal(adDecision({ ...config, max_ads_per_session: 0 }, null).eligible, false);
  assert.equal(consumeAd({ getItem() { throw Error('denied'); } }, config), null);
  const state = storage();
  state.setItem(STORAGE_KEY, '{bad json');
  assert.equal(consumeAd(state, config), null);
  assert.equal(consumeAd({ getItem() { return null; }, setItem() { throw Error('quota'); } }, config), null);
});
test('only credential-free HTTPS ad links are accepted', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,ad', 'http://ad.example', 'https://user:pass@ad.example']) {
    assert.equal(httpsUrl(url), null);
  }
  assert.equal(httpsUrl('https://ad.example/path'), 'https://ad.example/path');
});
test('cooldown remains in force across session rollover and backward clocks', () => {
  const now = 100000000;
  const stored = { startedAt: now - 360 * 60000, lastAt: now - 1000, count: 2 };
  assert.equal(adDecision(config, stored, now).eligible, false);
  assert.equal(adDecision(config, { ...stored, lastAt: now + 1000 }, now).eligible, false);
});
test('initial click delay waits before the first ad and then uses cooldown', () => {
  const delayed = { ...config, click_initial_delay_seconds: 120, click_cooldown_minutes: 5 };
  const state = storage();
  const now = 100000000;
  assert.equal(consumeAd(state, delayed, now), null);
  assert.equal(consumeAd(state, delayed, now + 119000), null);
  assert.equal(consumeAd(state, delayed, now + 120000), 'https://ads.example/ad');
  assert.equal(consumeAd(state, delayed, now + 240000), null);
  assert.equal(consumeAd(state, delayed, now + 420000), 'https://ads.example/ad');
});
test('player has no third-party scripts or obsolete channel overlay; ad frame is isolated', () => {
  const html = readFileSync(new URL('../player/player.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]*src=["']https?:/);
  assert.doesNotMatch(html, /broadcast-decoy|broadcast-channel-name|atOptions|profitablerate/);
  const controller = readFileSync(new URL('../player/ads-controller.js', import.meta.url), 'utf8');
  assert.match(controller, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(controller, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.doesNotMatch(controller, /location\.(?:replace|assign)|top\.location|allow-top-navigation|allow-popups|allow-same-origin/);
  for (const file of ['nginx.conf.example', 'nginx.http-player.conf.example', 'nginx.oracle.conf.example']) {
    const nginx = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(nginx, /script-src 'self'; style-src 'self'/);
    assert.match(nginx, /location = \/ad-frame\.html/);
    assert.match(nginx, /sandbox allow-scripts;/);
  }
});
