import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceMatchState, matchPlaybackState, frontendMatchState } from '../../shared/match-lifecycle.mjs';
import { createPlaybackResolver } from '../supabase.js';
import { createApp } from '../app.js';

test('source status, not match duration, controls termination', () => {
  const now = Date.now();
  for (const status of ['LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT']) {
    const row = { kickoff_time: new Date(now - 240 * 60_000).toISOString(), payload: { status, isFinished: true } };
    assert.equal(matchPlaybackState(row, { now }), 'live', status);
    assert.equal(frontendMatchState({ ...row.payload, playbackState: 'ended' }, -240), 'live', status);
  }
  for (const status of ['RESULT', 'FT', 'AET', 'PEN', 'FULL_TIME', 'FINISHED']) {
    assert.equal(sourceMatchState({ status, isLive: true }), 'ended', status);
  }
  assert.equal(sourceMatchState({ status: 'NOT_FINISHED' }), 'unknown');
  assert.equal(sourceMatchState({ status: { short: 'ET' } }), 'live');
  assert.equal(sourceMatchState({ isFinished: true }), 'ended');
  assert.equal(sourceMatchState({ status: 'NS', isFinished: true }), 'upcoming');
  assert.equal(matchPlaybackState({ kickoff_time: new Date(now - 240 * 60_000).toISOString() }, { now }), 'live');
  assert.equal(frontendMatchState({}, -240), 'live');
  for (const status of ['PST', 'CANC', 'ABD']) {
    assert.equal(matchPlaybackState({ payload: { status }, kickoff_time: new Date(now).toISOString() }, { now }), 'upcoming');
  }
});

test('both frontend lifecycle modules stay identical to the shared backend contract', () => {
  const canonical = readFileSync(new URL('../../shared/match-lifecycle.mjs', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../../../foottv6/shared/match-lifecycle.mjs', import.meta.url), 'utf8'), canonical);
  for (const path of ['../../assets/js/matches.js', '../../../foottv6/assets/js/matches.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /import \{ frontendMatchState \} from/);
    assert.doesNotMatch(source, /getMatchDuration|diffMins < -|diff < -duration/);
  }
});

test('list metadata keeps a prolonged match live and closes only at provider FT', async t => {
  const row = { match_id: 'prolonged', home_team: 'Real Madrid', away_team: 'Barcelona', league: 'La Liga',
    kickoff_time: new Date(Date.now() - 240 * 60_000).toISOString(), source_ready: true, payload: { status: 'P' } };
  const config = { secret: 'test-secret-with-at-least-32-bytes', hmacSecret: 'test-hmac-with-at-least-32-bytes',
    frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: 'https://api.example',
    frontendOrigins: new Set(['https://koratv.click']), upstreamOrigins: new Set(), trustedProxies: [],
    enableAntiBot: false, getMatchesForOrigin: async () => [row] };
  const server = createApp({ config, redis: {} }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const read = async () => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/match-info?matchId=prolonged`,
    { headers: { Origin: config.frontend } })).json()).match;
  const live = await read();
  assert.equal(live.playbackState, 'live');
  assert.equal(live.sourceReady, true);
  row.payload.status = 'FT';
  const ended = await read();
  assert.equal(ended.playbackState, 'ended');
  assert.equal(ended.sourceReady, false);
});

test('protected playback ignores the legacy duration cutoff but honors provider completion', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const row = { id: 'long-match', match_id: 'long-match', active: true, source: 'kooora',
    kickoff_time: new Date(Date.now() - 240 * 60_000).toISOString(), channel: 'beIN SPORTS HD 1',
    payload: { status: 'ET', broadcast: { source: 'kooora', channels: ['beIN SPORTS HD 1'] } } };
  globalThis.fetch = async input => Response.json(new URL(input).pathname.endsWith('/matches') ? [row]
    : [{ id: 1, name: row.channel, active: true, original_url: 'https://media.example.com/live/test/1.m3u8' }]);
  const resolve = createPlaybackResolver({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key', STREAM_CLOSES_AFTER_MINUTES: '1' });
  assert.equal((await resolve(row.match_id)).is_streaming_active, true);
  row.payload.status = 'P';
  assert.equal((await resolve(row.match_id)).is_streaming_active, true);
  row.payload.status = 'PEN';
  assert.deepEqual(await resolve(row.match_id), { is_streaming_active: false, reason: 'ended' });
});
