import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKoooraMatches, persistMatchSnapshots, koooraTodayUrl, mergeExistingChannels } from '../scripts/sync-matches-from-source.js';
import { runOperatorMatchImport } from '../scripts/operator-match-import.mjs';

const pairs = [['روما', 'ريال مدريد'], ['مانشستر سيتي', 'باريس سان جيرمان'], ['ريال بيتيس', 'بورتو']];
const group = (name, prefix, time) => ({ competition: { name }, matches: pairs.map(([home, away], i) => ({ id: `${prefix}-${i}`, teamA: { name: home }, teamB: { name: away }, startDate: `2026-10-14T${time}:00Z`, status: 'FIXTURE' })) });
const html = groups => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { data: groups } } })}</script>`;
const fixture = html([group('دوري أبطال أوروبا', 'senior', '19:00'), group('دوري أبطال أوروبا للشباب', 'youth', '12:00')]);

test('large Arabic fixture IDs use bounded read batches and fail closed on any batch error', async () => {
  const rows = Array.from({ length: 99 }, (_, i) => ({ match_id: `kooora_${i}_${'المباراة'.repeat(8)}`, payload: { status: 'RESULT' } }));
  const batches = [];
  let fail = false;
  const client = { from() { return this; }, select() { return this; }, async in(_key, ids) {
    batches.push(ids);
    assert.ok(ids.reduce((n, id) => n + encodeURIComponent(id).length + 4, 0) <= 4000);
    return fail ? { error: { code: 'network' } } : { data: ids.map(match_id => ({ match_id, updated_at: '2026-10-17T01:00:00Z', payload: {} })) };
  } };
  const merged = await mergeExistingChannels(client, rows);
  assert.equal(merged.rows.length, 99); assert.equal(merged.versions.size, 99);
  assert.ok(batches.length > 1);
  fail = true;
  await assert.rejects(mergeExistingChannels(client, rows), /Cannot safely merge/);
});

test('operator metadata refresh runs a Kooora-only sync without requiring team names', async () => {
  const result = await runOperatorMatchImport('refresh', {}, { sync: async options => {
    assert.deepEqual(options, { dryRunMode: false }); return { parsed: 20, upserted: 20 };
  } });
  assert.deepEqual(result, { parsed: 20, upserted: 20 });
  await assert.rejects(runOperatorMatchImport('refresh', {}, { sync: async () => ({ parsed: 0, upserted: 0 }) }), /source_search_failed/);
});

test('senior and youth names cannot share an ingestion or manual-search identity', () => {
  const senior = parseKoooraMatches(fixture);
  assert.equal(senior.length, 3);
  assert.ok(senior.every(row => row.payload.sourceMatchId.startsWith('senior-')));
  assert.equal(senior[0].match_id, 'kooora_2026-10-14_روما_vs_ريال_مدريد');
  const all = parseKoooraMatches(fixture, { includeAll: true });
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map(row => row.match_id)).size, 6);
  const imported = parseKoooraMatches(fixture, { includeMatchIds: new Set(all.map(row => row.match_id)) });
  assert.equal(imported.length, 3);
  assert.ok(imported.every(row => row.league === 'دوري أبطال أوروبا'));
});

test('a youth snapshot cannot overwrite a senior row even with a legacy colliding ID', async () => {
  const [senior] = parseKoooraMatches(fixture), youth = { ...senior, league: 'دوري أبطال أوروبا للشباب' };
  const written = [];
  const client = { from() { return { upsert(rows) { written.push(...rows); return this; }, async select() { return { data: written.map(row => ({ match_id: row.match_id })), error: null }; } }; } };
  assert.equal(await persistMatchSnapshots(client, [senior, youth], new Map()), 1);
  assert.deepEqual(written.map(row => row.league), ['دوري أبطال أوروبا']);
});

test('dated ingestion rejects a cached previous day and uses the Morocco calendar date', () => {
  assert.match(koooraTodayUrl('2026-10-14', {}), /\/2026-10-14$/);
  assert.equal(koooraTodayUrl('2026-10-14', { MATCH_SOURCE_URL: 'https://fixture.test' }), 'https://fixture.test');
  assert.equal(parseKoooraMatches(fixture, { expectedDate: '2026-10-13' }).length, 0);
  assert.equal(parseKoooraMatches(fixture, { expectedDate: '2026-10-14' }).length, 3);
  const midnight = fixture.replaceAll('2026-10-14T19:00:00Z', '2026-10-13T23:30:00Z');
  assert.equal(parseKoooraMatches(midnight, { expectedDate: '2026-10-14' }).length, 3);
});

test('manual search cannot reintroduce excluded European youth matches', async () => {
  const rows = parseKoooraMatches(fixture, { includeAll: true }).filter(row => row.league.endsWith('للشباب'));
  const result = await runOperatorMatchImport('search', { homeTeam: 'روما', awayTeam: 'ريال مدريد' }, { load: async () => rows });
  assert.equal(result.matches.length, 0);
});
