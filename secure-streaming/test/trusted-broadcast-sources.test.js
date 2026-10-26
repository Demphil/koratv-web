import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { officialBeinChannel, parseBeinGuide, resolveBeinBroadcast, applyTrustedBroadcastChannels, loadBeinGuide } from '../scripts/trusted-broadcast-sources.js';
import { reconcileBroadcasts, broadcastChannelCandidates } from '../../shared/match-broadcasts.mjs';

const channels = { rows: [{ id: 'ar4', name: 'beIN SPORTS 4' }, { id: 'en1', name: 'beIN SPORTS EN 1' }] };
const event = (overrides = {}) => ({ id: 'live-sevilla', channelId: 'ar4', title: 'Sevilla vs Osasuna - Spanish LaLiga 2026/2027 - Week 10',
  startDate: '2026-10-26T19:48:00Z', endDate: '2026-10-26T22:00:00Z', live: true, replay: false, sportType: { name: 'Football' }, category: 'Spanish League - Primera Division', ...overrides });
const row = (overrides = {}) => reconcileBroadcasts([{ match_id: 'sevilla', source: 'kooora', home_team: 'إشبيلية', away_team: 'أوساسونا',
  league: 'الدوري الإسباني', kickoff_time: '2026-10-26T20:00:00Z', payload: { channels: ['beIN SPORTS HD 5', 'Fixture TV'], sourceMatchId: 'source-id' }, ...overrides }])[0];

test('official channel normalization preserves number, language and AFC/MAX edition', () => {
  assert.equal(officialBeinChannel('beIN SPORTS 4'), 'beIN SPORTS HD 4');
  assert.equal(officialBeinChannel('beIN SPORTS 4 AFC'), 'beIN SPORTS AFC 4');
  assert.equal(officialBeinChannel('beIN SPORTS MAX 4'), 'beIN SPORTS MAX 4');
  assert.equal(officialBeinChannel('beIN SPORTS EN 1'), 'beIN SPORTS ENG 1');
  assert.equal(officialBeinChannel('beIN SPORTS FR 1'), 'beIN SPORTS FRANCE 1');
  assert.equal(officialBeinChannel('beIN SPORTS 4K HDR'), '');
});

test('only a live exact fixture in its coverage window confirms a channel', () => {
  const events = parseBeinGuide(channels, { count: 4, rows: [event(), event({ id: 'replay', live: false }),
    event({ id: 'wrong-opponent', title: 'Sevilla vs Barcelona - LaLiga' }), event({ id: 'english', channelId: 'en1' })] });
  assert.deepEqual(resolveBeinBroadcast(row(), events).map(e => e.id), ['live-sevilla', 'english']);
  assert.equal(resolveBeinBroadcast(row({ kickoff_time: '2026-10-27T20:00:00Z' }), events).length, 0);
  assert.equal(resolveBeinBroadcast(row({ league: 'LaLiga U19' }), events).length, 0);
  assert.equal(resolveBeinBroadcast(row({ kickoff_time: '2026-10-26T22:00:00Z' }), events).length, 0);
  assert.equal(parseBeinGuide(channels, { rows: [event({ replay: true })] }).length, 0);
  assert.equal(parseBeinGuide(channels, { rows: [event({ sportType: { name: 'Basketball' } })] }).length, 0);
  assert.equal(parseBeinGuide(channels, { rows: [event({ title: 'Al Ain FC (UAE) vs Tractor FC (IRN) - AFC Champions League Elite 2026/2027 - MD 3', sportType: { name: 'Other' }, category: 'Sports General' })] }).length, 1);
  assert.throws(() => parseBeinGuide(channels, { count: 3001, rows: [] }), /invalid_bein_guide/);
});

test('official correction preserves Kooora evidence and non-beIN alternatives, shared by automatic and operator imports', async () => {
  const events = parseBeinGuide(channels, { rows: [event(), event({ id: 'en', channelId: 'en1' })] });
  let requests = 0;
  const result = await applyTrustedBroadcastChannels(null, [row(), row()], { loadGuide: async () => { requests++; return { checkedAt: Date.now(), events }; } });
  assert.equal(requests, 1);
  assert.equal(result.rows[0].channel, 'beIN SPORTS HD 4');
  assert.equal(result.rows[0].payload.broadcast.beinVerification.state, 'confirmed');
  assert.deepEqual(result.rows[0].payload.broadcast.koooraChannels, ['beIN SPORTS HD 5', 'Fixture TV']);
  assert.deepEqual(broadcastChannelCandidates(result.rows[0]), ['beIN SPORTS HD 4', 'beIN SPORTS ENG 1', 'Fixture TV']);
  assert.equal(row().channel, 'beIN SPORTS HD 5');
});

test('official guide transport failure or no match never replaces an existing working assignment with a guess', async () => {
  for (const loadGuide of [async () => { throw new Error('test_timeout'); }, async () => ({ checkedAt: Date.now(), events: [] })]) {
    const result = await applyTrustedBroadcastChannels(null, [row()], { loadGuide });
    assert.equal(result.rows[0].channel, 'beIN SPORTS HD 5');
    assert.notEqual(result.rows[0].payload.broadcast.beinVerification.state, 'confirmed');
  }
  let calls = 0;
  await applyTrustedBroadcastChannels(null, [row({ payload: { channels: ['Fixture TV'] } })], { loadGuide: async () => { calls++; } });
  assert.equal(calls, 0);
});

test('schedule cache shares requests for a day and refreshes after five minutes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bein-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const request = async url => { calls++; return url.includes('/tv-channel?') ? channels : { rows: [event()], count: 1 }; };
  const options = { request, cacheFile: join(dir, 'cache.json'), now: Date.parse('2026-10-26T18:00:00Z') };
  assert.equal((await loadBeinGuide('2026-10-26', options)).events.length, 1);
  await loadBeinGuide('2026-10-26', options);
  assert.equal(calls, 2);
  await loadBeinGuide('2026-10-26', { ...options, now: options.now + 5 * 60_000 });
  assert.equal(calls, 4);
  const stale = await loadBeinGuide('2026-10-26', { ...options, now: options.now + 11 * 60_000,
    request: async () => { throw new Error('test_timeout'); } });
  assert.equal(stale.stale, true);
  assert.equal(stale.events.length, 1);
  await assert.rejects(loadBeinGuide('2026-10-26', { ...options, now: options.now + 36 * 60_000,
    request: async () => { throw new Error('test_timeout'); } }), /test_timeout/);
});
