import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_STREAM_OPENS_BEFORE_MINUTES, frontendMatchState, matchPlaybackState, sourceMatchState } from '../shared/match-lifecycle.mjs';

test('the frontend opens at 30 minutes even when cached metadata says upcoming', () => {
  assert.equal(DEFAULT_STREAM_OPENS_BEFORE_MINUTES, 30);
  for (const status of ['FIXTURE', 'NS', '']) {
    const match = { status, playbackState: 'upcoming' };
    assert.equal(frontendMatchState(match, 30 + 1 / 60000), 'upcoming');
    assert.equal(frontendMatchState(match, 30), 'live');
    assert.equal(frontendMatchState(match, 29), 'live');
    assert.equal(frontendMatchState(match, -1), 'live');
  }
});

test('the default wait dialog cannot show the retired 20-minute promise', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../assets/js/matches.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html + source, /20 دقيقة|بعشرين دقيقة/);
  assert.match(html, /قبل البداية بـ 30 دقيقة/);
});

test('finished and unavailable matches stay closed during the preparation window', () => {
  for (const status of ['FT', 'RESULT', 'PEN']) {
    assert.equal(frontendMatchState({ status, playbackState: 'live' }, 20), 'ended');
  }
  for (const status of ['PST', 'POSTPONED', 'CANC', 'ABD']) {
    assert.equal(frontendMatchState({ status, playbackState: 'live' }, 20), 'upcoming');
  }
  assert.equal(frontendMatchState({ playbackState: 'ended' }, 20), 'ended');
  assert.equal(frontendMatchState({ playbackState: 'upcoming' }, NaN), 'upcoming');
  assert.equal(frontendMatchState({ status: 'HT' }, -240), 'live');
});

test('frontend and protected playback share the same opening boundary', () => {
  const kickoff = Date.parse('2026-11-17T21:00:00Z');
  const row = { kickoff_time: new Date(kickoff).toISOString(), payload: { status: 'FIXTURE' } };
  for (const minutes of [31, 30.001, 30, 29, 0]) {
    assert.equal(matchPlaybackState(row, { now: kickoff - minutes * 60000 }),
      frontendMatchState({ ...row.payload, playbackState: 'upcoming' }, minutes));
  }
});

test('the rendered card links to the player before kickoff, not to the wait dialog', () => {
  const source = readFileSync(new URL('../assets/js/matches.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function renderMatch('), source.indexOf('function normalizeMatchName('));
  const render = vm.runInNewContext(`${block};renderMatch`, {
    frontendMatchState, sourceMatchState, matchStartDate: match => new Date(match.scheduledAt),
    opaqueWatchId: () => '123', playerUrlForMatch: () => 'https://fabor.sbs/739184.html?match=123',
    scoreMarkup: value => value, cleanScore: value => value, cleanText: value => value || '',
    renderLiveData: () => '', renderApiFootballMap: () => '',
  });
  const match = { matchId: 'pre-match', status: 'FIXTURE', playbackState: 'upcoming',
    homeTeam: { name: 'Home' }, awayTeam: { name: 'Away' }, score: 'VS' };
  const renderAt = minutes => render({ ...match, scheduledAt: new Date(Date.now() + minutes * 60000).toISOString() });
  assert.match(renderAt(29), /href="https:\/\/fabor\.sbs\/739184\.html\?match=123"/);
  assert.doesNotMatch(renderAt(29), /href="#wait-modal"/);
  assert.match(renderAt(31), /href="#wait-modal"/);
  const stale = render({ ...match, scheduleOnly: true, status: 'LIVE', scheduledAt: new Date(Date.now() - 60000).toISOString() });
  assert.match(stale, /data-disabled-reason="status_pending"/);
  assert.doesNotMatch(stale, /data-secure-match-id=/);
  const selected = render({ ...match, selectedForBroadcast: true, scheduleOnly: true,
    scheduledAt: new Date(Date.now() + 29 * 60000).toISOString() });
  assert.match(selected, /data-secure-match-id=/);
  assert.match(selected, /match-watch-action/);
  const tooEarly = render({ ...match, selectedForBroadcast: true, scheduleOnly: true,
    scheduledAt: new Date(Date.now() + 31 * 60000).toISOString() });
  assert.doesNotMatch(tooEarly, /data-secure-match-id=/);
  const finished = render({ ...match, selectedForBroadcast: true, status: 'RESULT',
    scheduledAt: new Date(Date.now() - 90 * 60000).toISOString() });
  assert.doesNotMatch(finished, /data-secure-match-id=/);
});
