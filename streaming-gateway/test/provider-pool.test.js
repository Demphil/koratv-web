import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPool, PoolError } from '../provider-pool.js';
import { basePriority } from '../priority.js';

test('releasing a prewarm viewer frees an idle worker without evicting real viewers', () => {
  const pool = new ProviderPool();
  try {
    const playback = {match_id:'ending', channel_id:'Ending TV', provider_sources:{A:'https://example.test/live.m3u8'}};
    const lease = pool.acquire(playback, 'prewarm:ending');
    pool.acquire(playback, 'real-viewer');
    assert.equal(pool.releaseViewer(lease.key, 'prewarm:ending'), true);
    assert.equal(pool.valid(lease), true);
    assert.equal(pool.snapshot()[0].viewers, 1);
    pool.releaseViewer(lease.key, 'real-viewer');
    assert.equal(pool.snapshot().length, 0);
  } finally { pool.close(); }
});
import { singleQualityManifest } from '../single-quality.js';
import { selectProviderChannel, createProviderCatalog } from '../provider-catalog.js';
import { HlsProgressMonitor } from '../hls-progress.js';
import { matchChannels, normalizeName } from '../../shared/provider-channel-match.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('assigned account is preferred and a free same-channel standby replaces HTTP 509', t => {
  const { pool } = setup(t);
  const match = { ...playback('selected', 100), preferred_provider: 'B' };
  const initial = pool.acquire(match, 'prewarm:selected');
  assert.equal(initial.provider, 'B');
  pool.fail(initial, 509);
  const standby = pool.acquire(match, 'prewarm:selected');
  assert.equal(standby.provider, 'A');
  assert.equal(pool.acquire(match, 'visitor').id, standby.id);
});

test('three independent accounts hold three matches, reject a fourth, and preserve peers on failure', t => {
  const { pool } = setup(t);
  const match = id => playback(id, 100, Object.fromEntries(['A','B','C'].map(p => [p, `https://${p.toLowerCase()}.example/${id}.m3u8`])));
  const leases = ['one','two','three'].map(id => pool.acquire(match(id), id));
  assert.deepEqual(leases.map(l => l.provider), ['A','B','C']);
  assert.throws(() => pool.acquire({ ...match('four'), priority_score: 10 }, 'four'), PoolError);
  assert.ok(leases.every(l => pool.valid(l)));
  pool.fail(leases[2]);
  assert.ok(pool.valid(leases[0])); assert.ok(pool.valid(leases[1]));
  assert.equal(pool.failures.C, 1);
});

test('provider catalog ignores legacy account expiry but retains manual override expiry', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-catalog-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json'), overridePath = join(dir, 'override.json');
  writeFileSync(catalogPath, JSON.stringify({ providers: { A: { enabled: true }, B: { enabled: true, expiresAt: '2000-01-01T00:00:00Z' }, C: { enabled: true } }, channels: { sport: { A: 'https://fresh-a.example/live', B: 'https://b.example/live', C: 'https://c.example/live' } } }));
  writeFileSync(overridePath, JSON.stringify({ matches: { old: { channel: 'sport', expiresAt: '2000-01-01T00:00:00Z' } } }));
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: catalogPath, MANUAL_BROADCAST_OVERRIDE_PATH: overridePath });
  assert.deepEqual(catalog.sources('sport', 'https://stale-a.example/live'), { A: 'https://fresh-a.example/live', B: 'https://b.example/live', C: 'https://c.example/live' });
  assert.equal(catalog.override('old'), null);
});

test('provider catalog can be forced to refresh before selecting a replacement URL', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-catalog-refresh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json'), overridePath = join(dir, 'override.json');
  writeFileSync(catalogPath, JSON.stringify({ providers: { C: { enabled: true } }, channels: { sport: { C: 'https://old.example/live.m3u8' } } }));
  writeFileSync(overridePath, '{"matches":{}}');
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: catalogPath, MANUAL_BROADCAST_OVERRIDE_PATH: overridePath });
  assert.equal(catalog.sources('sport').C, 'https://old.example/live.m3u8');
  writeFileSync(catalogPath, JSON.stringify({ providers: { C: { enabled: true } }, channels: { sport: { C: 'https://fresh.example/live.m3u8' } } }));
  catalog.refreshNow();
  assert.equal(catalog.sources('sport').C, 'https://fresh.example/live.m3u8');
});

test('catalog refresh invalidates negative name matches without discarding healthy data on a partial write', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-catalog-cache-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'catalog.json');
  writeFileSync(path, JSON.stringify({ providers: { A: { enabled: true } }, channels: {} }));
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: path });
  assert.equal(catalog.resolve('beIN SPORTS HD 1'), null);
  writeFileSync(path, JSON.stringify({ providers: { A: { enabled: true } },
    channels: { 'Sports One': { A: 'https://provider.example/live.m3u8', sourceNames: { A: 'beIN SPORTS HD 1' },
      sourceGroups: { A: 'AR | SPORTS' }, sourcePolicyVersions: { A: 2 } } } }));
  catalog.refreshNow();
  assert.equal(catalog.resolve('beIN SPORTS HD 1'), 'Sports One');
  writeFileSync(path, '{');
  catalog.refreshNow();
  assert.equal(catalog.resolve('beIN SPORTS HD 1'), 'Sports One');
});

test('provider catalog resolves Kooora broadcaster aliases against source names', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-catalog-alias-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json'), overridePath = join(dir, 'override.json');
  writeFileSync(catalogPath, JSON.stringify({
    providers: { A: { enabled: true }, B: { enabled: true } },
    channels: {
      'SABC+ HD': {
        A: 'https://a.example/sabc.m3u8',
        sourceNames: { A: 'ZA | SABC Plus HD' }
      },
      'beIN Connect HD': {
        B: 'https://b.example/connect.m3u8',
        sourceNames: { B: 'AR | beIN SPORTS CONNECT FHD' },
        sourceGroups: { B: 'AR | SPORTS' }, sourcePolicyVersions: { B: 2 }
      }
    }
  }));
  writeFileSync(overridePath, '{"matches":{}}');
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: catalogPath, MANUAL_BROADCAST_OVERRIDE_PATH: overridePath });
  assert.equal(catalog.resolve('SABC Plus'), 'SABC+ HD');
  assert.equal(catalog.sources('SABC Plus').A, 'https://a.example/sabc.m3u8');
  assert.equal(catalog.resolve('beIN SPORTS CONNECT'), 'beIN Connect HD');
  assert.equal(catalog.sources('beIN SPORTS CONNECT').B, 'https://b.example/connect.m3u8');
});

test('provider catalog skips placeholder channel rows without enabled sources', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-catalog-placeholder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json'), overridePath = join(dir, 'override.json');
  writeFileSync(catalogPath, JSON.stringify({
    providers: { B: { enabled: true } },
    channels: {
      'MBC Action': { sourceNames: {} },
      '[AR] MBC ACTION': {
        B: 'https://b.example/mbc-action.m3u8',
        sourceNames: { B: '[AR] MBC ACTION' }
      },
      'Abu Dhabi Sports 2': { sourceNames: {} },
      '[AR] ABU DHABI SPORT 2 HD': {
        B: 'https://b.example/ad-sports-2.m3u8',
        sourceNames: { B: '[AR] ABU DHABI SPORT 2 HD' }
      }
    }
  }));
  writeFileSync(overridePath, '{"matches":{}}');
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: catalogPath, MANUAL_BROADCAST_OVERRIDE_PATH: overridePath });
  assert.equal(catalog.resolve('MBC Action'), '[AR] MBC ACTION');
  assert.equal(catalog.sources('MBC Action').B, 'https://b.example/mbc-action.m3u8');
  assert.equal(catalog.resolve('Abu Dhabi Sports 2'), '[AR] ABU DHABI SPORT 2 HD');
  assert.equal(catalog.sources('Abu Dhabi Sports 2').B, 'https://b.example/ad-sports-2.m3u8');
});

test('provider channel matcher resolves current Kooora broadcaster variants', () => {
  const entries = [
    { name: '[AR] MBC ACTION', group: 'AR | ENTERTAINMENT', url: 'https://p.example/mbc.m3u8' },
    { name: '[AR] ABU DHABI SPORT2 FHD', group: 'AR | ARAB SPORT', url: 'https://p.example/ad2.m3u8' },
    { name: '[AR] OMAN SPORT TV', group: 'AR | ARAB SPORT', url: 'https://p.example/oman.m3u8' },
    { name: '[KW] KUWAIT SPORT HD', group: 'KW | SPORT', url: 'https://p.example/kuwait.m3u8' },
    { name: 'AR-SP| ART ALKASS 2 HD', group: 'AR | ARAB SPORT', url: 'https://p.example/kass2.m3u8' },
    { name: 'AR-SPI MA ARRYADIA TNT', group: 'AR | ARAB SPORT', url: 'https://p.example/arryadia.m3u8' }
  ].map((entry) => ({ ...entry, rawName: entry.name, search: normalizeName(`${entry.name} ${entry.group}`) }));
  const matches = matchChannels([
    'MBC Action',
    'Abu Dhabi Sports 2',
    'Oman Sports TV',
    'Kuwait Sport TV',
    'AL KASS Two',
    'SNRT'
  ], entries);
  assert.deepEqual(Object.fromEntries(matches.map((match) => [match.name, match.source_name])), {
    'MBC Action': '[AR] MBC ACTION',
    'Abu Dhabi Sports 2': '[AR] ABU DHABI SPORT2 FHD',
    'Oman Sports TV': '[AR] OMAN SPORT TV',
    'Kuwait Sport TV': '[KW] KUWAIT SPORT HD',
    'AL KASS Two': 'AR-SP| ART ALKASS 2 HD',
    'SNRT': 'AR-SPI MA ARRYADIA TNT'
  });
});

test('provider catalog exposes safe direct match route state without raw URLs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-route-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json');
  const overridePath = join(dir, 'override.json');
  const routeStatePath = join(dir, 'direct-match-route-state.json');
  writeFileSync(catalogPath, JSON.stringify({
    providers: { A: { enabled: true } },
    channels: { 'MBC Action': { A: 'https://private.example/live/user/pass/777.m3u8' } }
  }));
  writeFileSync(overridePath, '{"matches":{}}');
  writeFileSync(routeStatePath, JSON.stringify({
    matches: {
      'match-1': {
        status: 'RESOLVED',
        requestedChannels: ['MBC Action'],
        requestedChannel: 'MBC Action',
        resolvedChannel: 'MBC Action',
        providerIds: ['A']
      }
    }
  }));
  const catalog = createProviderCatalog({
    PROVIDER_CATALOG_PATH: catalogPath,
    MANUAL_BROADCAST_OVERRIDE_PATH: overridePath,
    DIRECT_MATCH_ROUTE_STATE_PATH: routeStatePath
  });
  assert.deepEqual(catalog.matchRoute('match-1'), {
    matchId: 'match-1',
    requestedChannels: ['MBC Action'],
    resolvedChannel: 'MBC Action',
    providerIds: ['A'],
    status: 'RESOLVED',
    source: 'direct-match-route-state',
  });
  assert.equal(JSON.stringify(catalog.matchRoute('match-1')).includes('private.example'), false);
  assert.equal(catalog.sources(catalog.matchRoute('match-1').resolvedChannel).A, 'https://private.example/live/user/pass/777.m3u8');
});

test('provider catalog exposes safe match assignment state without raw URLs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-assignment-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json');
  const overridePath = join(dir, 'override.json');
  const assignmentPath = join(dir, 'assignments.json');
  writeFileSync(catalogPath, JSON.stringify({ providers: { B: { enabled: true } }, channels: {} }));
  writeFileSync(overridePath, '{"matches":{}}');
  writeFileSync(assignmentPath, JSON.stringify({
    assignments: [{
      matchId: 'match-1',
      aliases: ['api-alias'],
      providerId: 'B',
      requestedChannel: 'beIN SPORTS HD 8',
      resolvedChannel: 'beIN SPORTS HD 8',
      priorityScore: 1100,
      manual: true,
    }],
    ignored: [{
      matchId: 'match-2',
      resolvedChannel: 'beIN SPORTS HD 3',
      priorityScore: 20,
    }],
  }));
  const catalog = createProviderCatalog({
    PROVIDER_CATALOG_PATH: catalogPath,
    MANUAL_BROADCAST_OVERRIDE_PATH: overridePath,
    MATCH_RESOURCE_ASSIGNMENT_PATH: assignmentPath
  });
  assert.deepEqual(catalog.matchAssignment('match-1'), {
    matchId: 'match-1',
    status: 'ASSIGNED',
    providerId: 'B',
    requestedChannel: 'beIN SPORTS HD 8',
    resolvedChannel: 'beIN SPORTS HD 8',
    priorityScore: 1100,
    broadcastRank: 1,
    manual: true,
    source: 'match-resource-assignment',
  });
  assert.equal(JSON.stringify(catalog.matchAssignment('match-1')).includes('https://'), false);
  assert.equal(catalog.matchAssignment('api-alias').providerId, 'B');
  assert.equal(catalog.matchAssignment('api-alias').matchId, 'api-alias');
  assert.equal(catalog.matchAssignment('api-alias').broadcastRank, 1);
  assert.equal(catalog.matchAssignment('match-2').status, 'WAITING');
});

test('playback standbys exclude providers reserved by another match and disabled accounts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-standby-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const catalogPath = join(dir, 'catalog.json');
  const assignmentPath = join(dir, 'assignments.json');
  writeFileSync(catalogPath, JSON.stringify({ providers: { A: { enabled: true }, B: { enabled: true },
    D: { enabled: true }, F: { enabled: false } }, channels: {} }));
  writeFileSync(assignmentPath, JSON.stringify({ assignments: [
    { matchId: 'selected', aliases: ['selected-alias'], providerId: 'B', resolvedChannel: 'Exact TV' },
    { matchId: 'other', providerId: 'A', resolvedChannel: 'Other TV' }
  ], ignored: [{ matchId: 'waiting' }] }));
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: catalogPath, MATCH_RESOURCE_ASSIGNMENT_PATH: assignmentPath });
  assert.deepEqual(catalog.playbackProviderIds('selected'), ['B', 'D']);
  assert.deepEqual(catalog.playbackProviderIds('selected-alias'), ['B', 'D']);
  assert.deepEqual(catalog.playbackProviderIds('waiting'), []);
});


test('higher scores never preempt a lease with active viewers', t => {
  const { pool } = setup(t);
  const a = pool.acquire(playback('vip', 100), 'one');
  const b = pool.acquire(playback('low', 10), 'two');
  assert.throws(() => pool.acquire(playback('next', 75), 'three'), PoolError);
  assert.ok(pool.valid(a)); assert.ok(pool.valid(b));
  pool.acquire(playback('vip', 100), 'four');
  assert.equal(pool.snapshot().find(row => row.provider === 'A').score, 140);
});

test('encoder sequence regression changes the timeline epoch, not the account health', () => {
  const monitor = new HlsProgressMonitor();
  const manifest = seq => `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${seq}\n#EXTINF:6,\n${seq}.ts`;
  assert.equal(monitor.observe('A', 'channel', manifest(935)).epoch, 0);
  const reset = monitor.observe('A', 'channel', manifest(361));
  assert.equal(reset.reset, true);
  assert.equal(reset.epoch, 1);
  assert.equal(reset.stalled, false);
  assert.equal(monitor.observe('A', 'channel', manifest(362)).epoch, 1);
  assert.equal(monitor.observe('B', 'channel', manifest(10)).epoch, 0);
});

test('an older overlapping playlist does not reset every viewer timeline', () => {
  const monitor = new HlsProgressMonitor();
  const manifest = seq => `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${seq}\n${Array.from({ length: 6 }, (_, i) => `#EXTINF:6,\n${seq + i}.ts`).join('\n')}`;
  monitor.observe('A', 'channel', manifest(2312));
  const delayed = monitor.observe('A', 'channel', manifest(2311));
  assert.equal(delayed.epoch, 0);
  assert.equal(delayed.stale, true);
  assert.equal(monitor.channels.get('A:channel').sequence, 2312);
  assert.equal(monitor.observe('A', 'channel', manifest(2313)).epoch, 0);
});

test('renewed source URLs fence old media descriptors without stealing another account', t => {
  const pool = new ProviderPool(); t.after(() => pool.close());
  const target = playback('target', 100, { A: 'https://a.example/old.m3u8' });
  const lease = pool.acquire(target, 'viewer');
  const id = lease.id;
  assert.equal(pool.updateSource(lease, lease.url), true);
  assert.equal(lease.id, id);
  const renewed = { ...target, provider_sources: { A: 'https://a.example/new.m3u8' } };
  pool.acquire(renewed, 'viewer');
  assert.equal(pool.updateSource(lease, renewed.provider_sources.A), true);
  assert.notEqual(lease.id, id);
  assert.equal(lease.provider, 'A');
  assert.equal(pool.valid(lease), true);
});

test('stalled HLS refreshes first, then fails over only to an idle same-channel account', t => {
  let now = 50_000;
  const order = [];
  const health = { stalled: () => { order.push('quarantine'); return now + 60_000; }, close() {} };
  const pool = new ProviderPool({ now: () => now, health }); t.after(() => pool.close());
  const monitor = new HlsProgressMonitor({ now: () => now });
  const target = playback('target', 100, { A: 'https://a.example/channel.m3u8', C: 'https://c.example/channel.m3u8' });
  const peer = playback('peer', 100, { B: 'https://b.example/other.m3u8' });
  const failed = pool.acquire(target, 'target-viewer');
  const protectedLease = pool.acquire(peer, 'peer-viewer');
  const manifest = seq => `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:${seq}\n#EXTINF:6,\n${seq}.ts`;
  monitor.observe('A', 'channel', manifest(10));
  now += 12_000;
  assert.equal(monitor.observe('A', 'channel', manifest(10)).stalled, true);
  order.push('catalog-refresh');
  const refreshed = { ...target, provider_sources: { ...target.provider_sources } };
  const stillCurrent = pool.acquire(refreshed, 'target-viewer');
  assert.equal(stillCurrent.provider, 'A');
  pool.failStalled(failed);
  const replacement = pool.acquire(refreshed, 'target-viewer');
  assert.equal(replacement.provider, 'C');
  assert.equal(monitor.observe('C', 'channel', manifest(400)).stalled, false);
  assert.ok(pool.valid(protectedLease));
  assert.deepEqual(order, ['catalog-refresh', 'quarantine']);
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
  pool.revoke('A');
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
