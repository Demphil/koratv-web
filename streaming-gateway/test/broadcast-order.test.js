import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

for (const file of ['../../assets/js/matches.js', '../../../foottv6/assets/js/matches.js']) {
  test(`${file}: scores keep explicit team sides and missing minutes are never estimated`, () => {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const block = text.slice(text.indexOf('function liveMinuteText('), text.indexOf('function cardsTotal('));
    const { minute, score } = vm.runInNewContext(`${block}; ({ minute: liveMinuteText, score: scoreMarkup })`);
    assert.equal(minute({ liveMinute: null }, new Date(0)), 'مباشر');
    assert.equal(minute({ liveMinute: 90, liveExtraMinute: 3 }), "90+3'");
    assert.match(score('1 - 0'), /data-score-side="home">1<\/span>.*data-score-side="away">0<\/span>/);
    assert.equal(score('VS'), 'VS');
  });
  test(`${file}: selected broadcasts lead the list in assignment order`, () => {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const block = text.slice(text.indexOf('function compareBroadcastPriority('), text.indexOf('function renderMatchCollections('));
    const compare = vm.runInNewContext(block + ';compareBroadcastPriority');
    const matches = [
      { id: 'ended', playbackState: 'ended', resourceStatus: 'ASSIGNED', broadcastRank: 1 },
      { id: 'unassigned', playbackState: 'live', sourceReady: false },
      { id: 'shared-ready', playbackState: 'live', sourceReady: true, resourceStatus: 'WAITING' },
      { id: 'second', playbackState: 'live', resourceStatus: 'ASSIGNED', broadcastRank: 2 },
      { id: 'manual-first', playbackState: 'upcoming', resourceStatus: 'ASSIGNED', broadcastRank: 1, manuallySelected: true },
    ];
    assert.deepEqual(matches.sort(compare).map(match => match.id), ['manual-first', 'second', 'shared-ready', 'unassigned', 'ended']);
    assert.equal(compare({ playbackState: 'live' }, { playbackState: 'live' }), 0);
    const scoreBlock = text.slice(text.indexOf('function matchCompletenessScore('), text.indexOf('function dedupeMatches('));
    const score = vm.runInNewContext(scoreBlock + ';matchCompletenessScore', { cardsTotal: () => 0 });
    assert.ok(score({ resourceStatus: 'ASSIGNED' }) > score({ playbackState: 'live', score: '1 - 0', homeTeam: { logo: 'logo' } }));
    assert.match(text, /const broadcastOrder = compareBroadcastPriority\(a, b\);\s+if \(broadcastOrder\) return broadcastOrder;/);
  });
}
