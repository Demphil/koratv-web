import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPool, PoolError } from '../provider-pool.js';
import { basePriority } from '../priority.js';
import { singleQualityManifest } from '../single-quality.js';
import { selectProviderChannel } from '../provider-catalog.js';

const playback = (id, score = 100, sources = { A: `https://a.example/${id}.m3u8`, B: `https://b.example/${id}.m3u8` }) =>
  ({ match_id: id, pool_key: id, channel_id: id, priority_score: score, provider_sources: sources });
const setup = t => { let now = 50000; const pool = new ProviderPool({ now: () => now }); t.after(() => pool.close()); return { pool, advance: ms => { now += ms; } }; };

test('two accounts reserve stable distinct matches and reject a lower-score third request', t => {
  const { pool } = setup(t);
  const a = pool.acquire(playback('first'), 'v1');
  const b = pool.acquire(playback('second'), 'v2');
  assert.equal(a.provider, 'A'); assert.equal(b.provider, 'B'); assert.ok(pool.valid(a));
  for (let i = 0; i < 10; i++) assert.throws(() => pool.acquire(playback('third', 10), 'v3'), PoolError);
  assert.ok(pool.valid(a)); assert.ok(pool.valid(b));
  assert.equal(pool.demands.get('third').viewers.size, 1);
});

test('viewer points count unique sessions, higher scores preempt only the weaker lease', t => {
  const { pool } = setup(t);
  const a = pool.acquire(playback('vip', 100), 'one');
  const b = pool.acquire(playback('low', 10), 'two');
  const c = pool.acquire(playback('next', 75), 'three');
  assert.equal(c.provider, 'B'); assert.ok(pool.valid(a)); assert.ok(!pool.valid(b));
  pool.acquire(playback('vip', 100), 'four');
  assert.equal(pool.snapshot().find(row => row.provider === 'A').score, 140);
});

test('idle lease releases at 15 seconds and refreshed activity keeps the other account', t => {
  const { pool, advance } = setup(t);
  pool.acquire(playback('idle'), 'one'); pool.acquire(playback('active'), 'two');
  advance(10000); pool.acquire(playback('active'), 'two'); advance(5000);
  const c = pool.acquire(playback('waiting', 10), 'three');
  assert.equal(c.provider, 'A'); assert.equal(pool.snapshot().length, 2);
});

test('403 fails over to a free account but never steals an occupied one', t => {
  const { pool } = setup(t);
  const first = pool.acquire(playback('first'), 'one'); pool.fail(first);
  assert.equal(pool.acquire(playback('first'), 'one').provider, 'B');
  pool.close();
  const other = new ProviderPool(); t.after(() => other.close());
  const a = other.acquire(playback('a', 100), 'one');
  const b = other.acquire(playback('b', 75), 'two');
  other.fail(a);
  assert.throws(() => other.acquire(playback('a', 100), 'one'), PoolError);
  assert.ok(other.valid(b));
});

test('expired viewer sessions stop contributing to score', t => {
  const { pool, advance } = setup(t);
  pool.acquire(playback('a'), 'one'); advance(10000);
  pool.acquire(playback('a'), 'two'); advance(10000);
  pool.acquire(playback('a'), 'two');
  assert.equal(pool.snapshot()[0].score, 120);
});

test('provider request queue serializes body reads and rejects stale prefetched work', async t => {
  const { pool } = setup(t);
  const a = pool.acquire(playback('a', 10, { A: 'https://a.example/a.m3u8' }), 'one');
  let active = 0, peak = 0;
  const jobs = Array.from({ length: 4 }, () => pool.run(a, async () => {
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return 200;
  }));
  await Promise.all(jobs); assert.equal(peak, 1);
  pool.acquire(playback('vip', 100, { A: 'https://a.example/vip.m3u8' }), 'two');
  await assert.rejects(pool.run(a, () => assert.fail('stale fetch must never reach upstream')), PoolError);
});

test('shared event ID counts audiences of both sites on the same lease', t => {
  const { pool } = setup(t);
  const a = pool.acquire({ ...playback('kooora_1'), pool_key: 'same-event' }, 'one');
  const b = pool.acquire({ ...playback('api-football_1'), pool_key: 'same-event', provider_sources: playback('kooora_1').provider_sources }, 'two');
  assert.equal(a.id, b.id); assert.equal(pool.snapshot()[0].viewers, 2);
});

test('matrix handles bilingual teams, leagues and exact channel numbers', () => {
  for (const home_team of ['المغرب', 'Morocco', 'Real Madrid', 'ريال مدريد', 'الرجاء', 'Raja Casablanca']) assert.equal(basePriority({ home_team }), 100);
  assert.equal(basePriority({ home_team: 'Egypt' }), 75);
  assert.equal(basePriority({ home_team: 'ليتوانيا' }), 40);
  assert.equal(basePriority({}, 'beIN SPORTS HD 1'), 100);
  assert.equal(basePriority({}, 'beIN SPORTS HD 12'), 10);
  assert.equal(basePriority({}, 'Arryadia TNT'), 100);
  assert.equal(basePriority({ league: 'UEFA Nations League' }), 75);
});

test('master playlists expose one 720p rendition and no I-frame stream', () => {
  const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\n360.m3u8\n#EXT-X-I-FRAME-STREAM-INF:URI="iframe.m3u8"';
  const result = singleQualityManifest(manifest);
  assert.equal((result.match(/#EXT-X-STREAM-INF:/g) || []).length, 1);
  assert.match(result, /720.m3u8/); assert.doesNotMatch(result, /1080.m3u8|360.m3u8|iframe.m3u8/);
});

test('catalog chooses one quality but rejects different channel editions', () => {
  const candidates = ['AR | BEIN-SPORTS 1 FHD', 'AR | BEIN-SPORTS 1 HD', 'AR | BEIN-SPORTS 12 HD'].map(source_name => ({ source_name }));
  assert.equal(selectProviderChannel({ name: 'beIN SPORTS HD 1', candidates }).source_name, 'AR | BEIN-SPORTS 1 HD');
  assert.equal(selectProviderChannel({ name: 'Arryadia S/D', candidates: [{ source_name: 'MA| ARRYADIA OLYMPICS SD' }] }), null);
  assert.equal(selectProviderChannel({ name: 'أون سبورت 2', candidates: [{ source_name: 'EGY| ON SPORT PLUS HD' }] }), null);
});
