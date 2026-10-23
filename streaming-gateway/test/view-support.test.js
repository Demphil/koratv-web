import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialSupportState, evaluateSupport, SUPPORT_HINT_TTL } from '../player/view-support-state.js';

const healthy = { controlHealthy: true, probe: 'clear', cosmeticHidden: false };
const blocked = { controlHealthy: true, probe: 'blocked', cosmeticHidden: false };
test('two independent successful checks are needed before a blocked notice can clear', () => {
  let state = initialSupportState();
  state = evaluateSupport(state, blocked); assert.equal(state.blocked, false);
  state = evaluateSupport(state, blocked); assert.equal(state.blocked, true);
  state = evaluateSupport(state, healthy); assert.equal(state.blocked, true);
  state = evaluateSupport(state, healthy); assert.equal(state.blocked, false);
});
test('refresh restores a recent confirmed requirement instead of dismissing it', () => {
  const now = 10000000;
  const state = initialSupportState(JSON.parse(JSON.stringify({ blocked: true, checkedAt: now - 5000 })), now);
  assert.equal(state.blocked, true);
  assert.equal(evaluateSupport(state, healthy).blocked, true);
  assert.equal(evaluateSupport(evaluateSupport(state, healthy), healthy).blocked, false);
});
test('expired, future, malformed and non-blocked hints cannot lock a new viewer', () => {
  for (const hint of [null, {}, { blocked: false, checkedAt: 100 }, { blocked: true, checkedAt: '100' },
    { blocked: true, checkedAt: 10000001 }, { blocked: true, checkedAt: 10000000 - SUPPORT_HINT_TTL }]) {
    assert.equal(initialSupportState(hint, 10000000).blocked, false);
  }
});
test('offline conditions, timeouts and one transient resource failure cannot accuse a fresh viewer', () => {
  let state = initialSupportState();
  for (const sample of [{ ...blocked, controlHealthy: false }, { ...healthy, probe: 'unknown' }, blocked, healthy]) {
    state = evaluateSupport(state, sample); assert.equal(state.blocked, false);
  }
});
test('repeated cosmetic hiding remains valid evidence when a separate probe times out', () => {
  const sample = { controlHealthy: true, probe: 'unknown', cosmeticHidden: true };
  assert.equal(evaluateSupport(evaluateSupport(initialSupportState(), sample), sample).blocked, true);
});
test('cosmetic hiding is detected without visiting an advertiser and cannot clear a confirmed requirement on network error', () => {
  let state = initialSupportState();
  const cosmetic = { ...healthy, cosmeticHidden: true };
  state = evaluateSupport(evaluateSupport(state, cosmetic), cosmetic);
  assert.equal(state.blocked, true);
  state = evaluateSupport(state, { controlHealthy: false, probe: 'unknown' });
  assert.equal(state.blocked, true);
});
test('notice code never pauses, reloads, mutes, replaces media or opens a window', () => {
  const source = readFileSync(new URL('../player/view-support.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /video\.(?:pause|play|load)\(|video\.(?:src|muted|currentTime)\s*=|hls\.|location\.|window\.open/);
  assert.match(source, /addEventListener\('playing'/);
  assert.match(source, /localStorage\.getItem\(SUPPORT_HINT_KEY\)/);
  assert.match(source, /controlUrl, \{ method: 'HEAD'/);
  assert.match(source, /container\.querySelector\('\.plyr'\)/);
  assert.doesNotMatch(source, /https:\/\/.*(?:al5sm|nap5k|omg10)/);
  assert.match(source, /event.key === 'Tab'/);
});
test('accessible non-dismissible prompt and isolated styles are present on the shared viewing page', () => {
  const html = readFileSync(new URL('../player/player.html', import.meta.url), 'utf8');
  assert.match(html, /id="watch-support-panel"[^>]*role="alertdialog"/);
  assert.match(html, /id="watch-support-check" type="button"/);
  assert.match(html, /type="module" src="\.\/view-support.js"/);
  const panel = html.slice(html.indexOf('<aside id="watch-support-panel"'), html.indexOf('</aside>'));
  assert.doesNotMatch(panel, /close|dismiss/);
  assert.equal((panel.match(/<button/g) || []).length, 1);
  const css = readFileSync(new URL('../player/view-support.css', import.meta.url), 'utf8');
  assert.match(css, /\[hidden\]\s*\{ display: none !important/);
  assert.match(css, /@container \(max-width: 440px\)/);
});
test('neutral local probe has no advertising request or impression logic', () => {
  const source = readFileSync(new URL('../player/ads/prebid-ads.js', import.meta.url), 'utf8');
  assert.match(source, /watch-support-probe/);
  assert.doesNotMatch(source, /fetch\(|https?:|window\.open|location\.|Image\(/);
});
