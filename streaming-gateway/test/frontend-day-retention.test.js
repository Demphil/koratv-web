import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sourceMatchState, nextMoroccoMidnight, matchListCacheControl } from '../../shared/match-lifecycle.mjs';

async function fixture(path, time = '2026-10-04T22:58:00Z', storageBlocked = false) {
  let now = Date.parse(time), response = [], calls = 0;
  const storage = new Map();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const check = () => { if (storageBlocked) throw new Error('Storage unavailable'); };
  const localStorage = { getItem: key => { check(); return storage.get(key) ?? null; }, setItem: (key, value) => { check(); return storage.set(key, value); }, removeItem: key => { check(); return storage.delete(key); } };
  const context = vm.createContext({ window: {}, localStorage, Date: Clock, Intl, sourceMatchState, nextMoroccoMidnight, AbortSignal,
    console: { error() {} }, fetch: async () => { calls++; if (typeof response === 'function') return response(); if (response instanceof Error) throw response; return { ok: true, json: async () => ({ matches: response }) }; } });
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source + '\nthis.api = {getTodayMatches,getTomorrowMatches,getCachedMatchSnapshot,getMoroccoDateKey,getNextMoroccoDayDelay};', context);
  return { api: context.api, storage, setTime: time => now = Date.parse(time), setRows: rows => response = rows, calls: () => calls };
}

test('Fraja retains completed results until midnight even when browser storage is unavailable', async () => {
  const f = await fixture('../../../foottv6/assets/js/api.js', '2026-10-04T22:58:00Z', true);
  f.setRows([ended, next]);
  assert.equal((await f.api.getTodayMatches())[0].matchId, 'final');
  await f.api.getTomorrowMatches();
  f.setTime('2026-10-04T22:59:59.999Z'); f.setRows([]);
  assert.equal((await f.api.getTodayMatches({ force: true }))[0].matchId, 'final');
  f.setTime('2026-10-04T23:00:00Z');
  assert.deepEqual(Array.from(f.api.getCachedMatchSnapshot().today, row => row.matchId), ['next']);
});

test('HTTP cache freshness and stale lifetime cannot cross Morocco midnight', () => {
  assert.equal(matchListCacheControl(Date.parse('2026-10-04T22:59:50Z')), 'public, max-age=10, s-maxage=10, stale-while-revalidate=0');
  assert.equal(matchListCacheControl(Date.parse('2026-10-04T22:59:59.999Z')), 'public, max-age=0, s-maxage=0, stale-while-revalidate=0');
  assert.equal(matchListCacheControl(Date.parse('2026-10-04T23:00:00Z')), 'public, max-age=15, s-maxage=30, stale-while-revalidate=120');
});
const ended = { matchId: 'final', homeTeam: 'Real Madrid', awayTeam: 'Barcelona', scheduledAt: '2026-10-04T14:00:00Z', status: 'FT', playbackState: 'ended', score: '2 - 1' };
const next = { ...ended, matchId: 'next', scheduledAt: '2026-10-05T14:00:00Z', status: 'FIXTURE', playbackState: 'upcoming', score: 'VS' };

for (const path of ['../../assets/js/api.js', '../../../foottv6/assets/js/api.js']) {
  test(`${path}: completed results survive omitted refreshes and expire exactly at the Morocco day boundary`, async () => {
    const f = await fixture(path); f.setRows([ended, next]);
    assert.equal((await f.api.getTodayMatches())[0].matchId, 'final');
    await f.api.getTomorrowMatches();
    f.setTime('2026-10-04T22:59:59.999Z'); f.setRows([]);
    assert.equal((await f.api.getTodayMatches({ force: true }))[0].matchId, 'final');
    f.setTime('2026-10-04T23:00:00Z');
    const snapshot = f.api.getCachedMatchSnapshot();
    assert.deepEqual(Array.from(snapshot.today, match => match.matchId), ['next']);
    f.setRows([next]); const before = f.calls();
    assert.deepEqual(Array.from(await f.api.getTodayMatches(), match => match.matchId), ['next']);
    assert.equal(f.calls(), before + 1, 'new day bypasses an unexpired request cache');
  });
  test(`${path}: old completed cache remains useful but stale live data and yesterday results never return`, async () => {
    const f = await fixture(path);
    f.storage.set('matches_cache_today_v2', JSON.stringify({ savedAt: Date.parse('2026-10-04T15:00:00Z'), data: [ended, { ...ended, matchId: 'stale-live', status: 'LIVE', playbackState: 'live' }] }));
    assert.deepEqual(Array.from(f.api.getCachedMatchSnapshot().today, match => match.matchId), ['final']);
    f.setRows([{ ...ended, score: '3 - 1' }]);
    assert.equal((await f.api.getTodayMatches())[0].score, '3 - 1', 'fresh authoritative result wins');
    f.setTime('2026-10-04T23:00:00Z'); f.setRows(new Error('offline'));
    assert.equal((await f.api.getTodayMatches({ force: true })).length, 0);
  });
  test(`${path}: rollover scheduling uses Morocco calendar dates including timezone transitions`, async () => {
    const { api } = await fixture(path);
    for (const time of ['2026-10-04T22:59:00Z', '2026-02-14T03:00:00Z', '2026-03-21T03:00:00Z', '2026-12-31T20:00:00Z']) {
      const now = new Date(time), delay = api.getNextMoroccoDayDelay(now);
      assert.ok(delay > 0 && delay <= 25 * 3600000);
      assert.equal(api.getMoroccoDateKey(new Date(now.getTime() + delay - 50)), api.getMoroccoDateKey(now));
      assert.notEqual(api.getMoroccoDateKey(new Date(now.getTime() + delay)), api.getMoroccoDateKey(now));
    }
  });
  test(`${path}: an old in-flight failure cannot erase the new day's request cache`, async () => {
    const f = await fixture(path, '2026-10-04T22:59:59Z'); let reject;
    f.setRows(() => new Promise((resolve, fail) => { reject = fail; }));
    const old = f.api.getTodayMatches();
    f.setTime('2026-10-04T23:00:00Z'); f.setRows([next]);
    assert.equal((await f.api.getTodayMatches())[0].matchId, 'next');
    reject(new Error('old_day_timeout')); await old;
    const before = f.calls(); await f.api.getTodayMatches(); assert.equal(f.calls(), before);
  });
}
