import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { frontendMatchState } from '../../shared/match-lifecycle.mjs';

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
  test(`${file}: newest live broadcasts lead upcoming matches regardless of assignment rank`, () => {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const block = text.slice(text.indexOf('function compareBroadcastPriority('), text.indexOf('function renderMatchCollections('));
    const compare = vm.runInNewContext(block + ';compareBroadcastPriority', {
      frontendMatchState, matchStartDate: match => new Date(match.scheduledAt || '2026-10-04T15:00:00Z'),
    });
    const now = new Date('2026-10-04T15:00:00Z');
    const matches = [
      { id: 'ended', playbackState: 'ended', resourceStatus: 'ASSIGNED', broadcastRank: 1 },
      { id: 'unassigned', playbackState: 'live', sourceReady: false },
      { id: 'shared-ready', playbackState: 'live', sourceReady: true, resourceStatus: 'WAITING' },
      { id: 'second', playbackState: 'live', resourceStatus: 'ASSIGNED', broadcastRank: 2 },
      { id: 'manual-first', playbackState: 'upcoming', resourceStatus: 'ASSIGNED', broadcastRank: 1, manuallySelected: true },
      { id: 'newest', playbackState: 'live', resourceStatus: 'ASSIGNED', broadcastRank: 8, scheduledAt: '2026-10-04T15:01:00Z' },
      { id: 'far-future', playbackState: 'upcoming', resourceStatus: 'SCHEDULED', scheduledAt: '2026-10-04T20:00:00Z' },
    ];
    assert.deepEqual(matches.sort((a,b) => compare(a,b,now)).map(match => match.id), ['newest', 'second', 'shared-ready', 'manual-first', 'far-future', 'unassigned', 'ended']);
    assert.equal(compare({ playbackState: 'live' }, { playbackState: 'live' }), 0);
    const scoreBlock = text.slice(text.indexOf('function matchCompletenessScore('), text.indexOf('function dedupeMatches('));
    const score = vm.runInNewContext(scoreBlock + ';matchCompletenessScore', { cardsTotal: () => 0 });
    assert.ok(score({ resourceStatus: 'ASSIGNED' }) > score({ playbackState: 'live', score: '1 - 0', homeTeam: { logo: 'logo' } }));
    assert.match(text, /return compareBroadcastPriority\(a, b, now\);/);
  });
}
