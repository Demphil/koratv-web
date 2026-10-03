const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeManualSelections } = require('./merge-manual-matches.cjs');
const options = { dateKey: '2026-10-03' };
const input = (name, matches, extra = {}) => ({ name, selection: { enabled: true, date: options.dateKey, matches, ...extra } });

test('both repositories share one ordered deduplicated selection', () => {
  const merged = mergeManualSelections([input('Kora', ['a', 'b']), input('Fraja', ['b', 'c'])], options);
  assert.deepEqual(merged.matches, ['a', 'b', 'c']);
  assert.equal(merged.enabled, true);
});
test('the shared eight-match limit rejects excess choices instead of truncating them', () => {
  assert.throws(() => mergeManualSelections([input('Kora', ['1', '2', '3', '4', '5']), input('Fraja', ['6', '7', '8', '9'])], options), /shared limit is 8/);
});
test('disabled and other-day choices do not leak into today', () => {
  const merged = mergeManualSelections([input('Kora', ['a'], { enabled: false }), input('Fraja', ['b'], { date: '2026-10-04' })], options);
  assert.equal(merged.enabled, false);
  assert.deepEqual(merged.matches, []);
});
test('invalid dates, identifiers and shapes fail before publication', () => {
  for (const extra of [{ date: '' }, { matches: [''] }, { matches: [null] }, { matches: ['x'.repeat(161)] }, { matches: 'a' }, { enabled: 'yes' }]) {
    assert.throws(() => mergeManualSelections([input('Kora', ['a'], extra)], options));
  }
});
