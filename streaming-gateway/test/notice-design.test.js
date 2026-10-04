import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNoticeDesign } from '../player/broadcast-notice.js';
import { validateNotices } from '../operator-state.js';

const base = { enabled: true, items: [{ text: 'Legacy message' }], repeats: 1, duration: 10, interval: 300, matchIds: [] };
test('old messages remain compatible and new ads default to a fully transparent surface', () => {
  const item = validateNotices(base).items[0];
  assert.equal(item.text, 'Legacy message'); assert.equal(item.title, ''); assert.equal(item.design.backgroundOpacity, 0); assert.equal(item.duration, null);
});
test('title, caption, style, placement and per-ad timing survive validation', () => {
  const input = { title: 'عنوان الإعلان', text: 'التعليق', duration: 45, design: { titleColor: '#ff0033', textColor: '#00cc88', titleSize: 34, textSize: 20, titleAnimation: 'pulse', textAnimation: 'rise', titleAnimationSeconds: 4, textAnimationSeconds: 1, placement: 'middle', imageSide: 'left', titlePosition: 'below', backgroundOpacity: 0 } };
  const item = validateNotices({ ...base, interval: 0, items: [input] }).items[0];
  assert.equal(item.title, input.title); assert.equal(item.duration, 45); assert.equal(item.design.titleSize, 34); assert.equal(item.design.textAnimation, 'rise'); assert.equal(item.design.placement, 'middle');
  assert.equal(validateNotices({ ...base, duration: 120 }).duration, 120);
  assert.equal(item.design.titleAnimationSeconds, 4); assert.equal(item.design.textAnimationSeconds, 1);
});
test('style values cannot inject CSS, arbitrary animation names, unsafe numbers or markup', () => {
  for (const design of [{ titleColor: 'red; background:url(x)' }, { titleAnimation: 'arbitrary' }, { textSize: 500 }, { backgroundOpacity: -1 }, { placement: 'outside' }, { textBold: 'yes' }]) assert.throws(() => normalizeNoticeDesign(design, true), /invalid_notice_design/);
  assert.throws(() => validateNotices({ ...base, items: [{ title: 'x'.repeat(101) }] }));
  assert.throws(() => validateNotices({ ...base, items: [{ title: 'x', duration: 0 }] }));
  assert.equal(validateNotices({ ...base, items: [{ title: '<script>plain text</script>' }] }).items[0].title, '<script>plain text</script>');
});
