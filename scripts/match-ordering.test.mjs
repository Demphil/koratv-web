import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { frontendMatchState, sourceMatchState } from '../shared/match-lifecycle.mjs';

const source = readFileSync(new URL('../assets/js/matches.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function compareBroadcastPriority('), source.indexOf('let displayedMatches;'));
const compare = vm.runInNewContext(`${block};compareBroadcastPriority`, {
  frontendMatchState, sourceMatchState, matchStartDate: match => new Date(match.scheduledAt),
});
const now = new Date('2026-11-17T20:00:00Z');
const fixture = (id, minutes, fields = {}) => ({ id, scheduledAt: new Date(now.getTime() + minutes * 60000).toISOString(),
  status: 'FIXTURE', playbackState: 'upcoming', ...fields });

test('live cards precede soon cards regardless of resource availability, then later and ended cards', () => {
  const rows = [
    fixture('ended', -90, { status: 'FT' }),
    fixture('later-waiting', 100, { resourceStatus: 'WAITING', sourceReady: false }),
    fixture('soon-45', 45),
    fixture('paused-live', -20, { status: 'HT', resourceStatus: 'PAUSED' }),
    fixture('live-waiting', -5, { status: '1H', resourceStatus: 'WAITING', sourceReady: false }),
    fixture('soon-15', 15, { playbackState: 'live' }),
    fixture('live-unassigned', -10, { status: '1H', sourceReady: false }),
    fixture('postponed', -120, { status: 'PST' }),
  ];
  assert.deepEqual(rows.sort((a, b) => compare(a, b, now)).map(row => row.id),
    ['live-waiting', 'live-unassigned', 'paused-live', 'soon-15', 'soon-45', 'later-waiting', 'postponed', 'ended']);
});

test('an open pre-match player is still upcoming in display order until actual kickoff', () => {
  const rows = [fixture('preparation', 10, { status: '', playbackState: 'live', resourceStatus: 'ASSIGNED' }),
    fixture('actual-live', -20, { status: 'LIVE', resourceStatus: 'WAITING' })];
  assert.deepEqual(rows.sort((a, b) => compare(a, b, now)).map(row => row.id), ['actual-live', 'preparation']);
});

test('explicit provider live status takes priority even if its schedule clock is slightly ahead', () => {
  const live = fixture('live', 1, { status: 'LIVE', sourceReady: false });
  assert.ok(compare(live, fixture('soon', 5), now) < 0);
  assert.equal(compare(live, live, now), 0);
});
