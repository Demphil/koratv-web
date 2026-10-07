import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKoooraMatches } from '../scripts/sync-matches-from-source.js';
import { runOperatorMatchImport } from '../scripts/operator-match-import.mjs';
import { validateMatchSearch, findRequestedMatches } from '../../shared/operator-match-search.mjs';
import { moroccoMatchDay, isOperatorImportedMatch } from '../../shared/operator-imported-match.mjs';
import { mergeRefreshedMatch } from '../../shared/match-broadcasts.mjs';

const kickoff = new Date().toISOString();
const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: [{ competition: { name: 'Regional Exhibition Cup' }, matches: [
  { id: 'exact-source-id', teamA: { name: 'Local Alpha' }, teamB: { name: 'Local Beta' }, startDate: kickoff, status: 'FIXTURE' },
  { id: 'other-source-id', teamA: { name: 'Other Alpha' }, teamB: { name: 'Other Beta' }, startDate: kickoff, status: 'FIXTURE' }
] }] } } })}</script>`;
const all = () => parseKoooraMatches(html, { includeAll: true });
const query = () => validateMatchSearch({ homeTeam: 'Local Alpha', awayTeam: 'Local Beta' });

test('manual search bypasses the league filter without changing normal ingestion', () => {
  assert.equal(parseKoooraMatches(html).length, 0);
  assert.equal(all().length, 2);
  const [target] = all();
  assert.deepEqual(parseKoooraMatches(html, { includeMatchIds: new Set([target.match_id]) }).map(row => row.match_id), [target.match_id]);
  assert.equal(findRequestedMatches(all(), query()).length, 1);
  assert.equal(findRequestedMatches(all(), { ...query(), homeTeam: 'Local Beta', awayTeam: 'Local Alpha' }).length, 1);
});

test('manual query rejects URLs, markup, identical teams and a different day', async () => {
  for (const homeTeam of ['a', 'https://example.com', '<script>x</script>', 'Local Beta']) assert.throws(() => validateMatchSearch({ homeTeam, awayTeam: 'Local Beta' }), /invalid_team_names/);
  assert.equal(findRequestedMatches(all(), { ...query(), day: '2020-01-01' }).length, 0);
  await assert.rejects(runOperatorMatchImport('search', { ...query(), day: '2020-01-01' }), /search_expired/);
});

test('manual refresh cannot replace an approved source fixture with a cancelled same-day duplicate', () => {
  const [row] = all();
  const duplicate = html.replace('other-source-id', 'cancelled-copy').replace('Other Alpha', 'Local Alpha').replace('Other Beta', 'Local Beta');
  const refreshed = parseKoooraMatches(duplicate, { includeMatchIds: new Set([row.match_id]), importedSourceIds: new Map([[row.match_id, 'exact-source-id']]) });
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].payload.sourceMatchId, 'exact-source-id');
});

test('manual import rechecks fixture identity and cancellation before writing', async () => {
  const [row] = all();
  let writes = 0;
  const dependencies = { load: async () => [{ ...row, payload: { ...row.payload, status: 'CANCELLED' } }], enrich: async () => {}, persist: async () => { writes++; } };
  await assert.rejects(runOperatorMatchImport('import', { ...query(), matchId: row.match_id, sourceMatchId: row.payload.sourceMatchId }, dependencies), /match_not_broadcastable/);
  await assert.rejects(runOperatorMatchImport('import', { ...query(), matchId: row.match_id, sourceMatchId: 'wrong-fixture' }, dependencies), /match_not_found/);
  assert.equal(writes, 0);
});

test('import approval applies only to the confirmed fixture and survives source refresh', async () => {
  const [row] = all();
  const result = await runOperatorMatchImport('import', { ...query(), matchId: row.match_id, sourceMatchId: row.payload.sourceMatchId }, {
    load: async () => [structuredClone(row)], enrich: async rows => { rows[0].payload.channels = ['beIN SPORTS HD 1']; },
    persist: async rows => { assert.equal(rows.length, 1); assert.ok(isOperatorImportedMatch(rows[0])); }
  });
  assert.equal(result.match.payload.operatorImport.day, moroccoMatchDay(kickoff));
  assert.ok(isOperatorImportedMatch(mergeRefreshedMatch(result.match, row)));
  assert.equal(isOperatorImportedMatch({ ...result.match, match_id: 'other-match' }), false);
  assert.equal(isOperatorImportedMatch({ ...result.match, kickoff_time: '2020-01-01T12:00:00Z' }), false);
  assert.equal(parseKoooraMatches(html).length, 0);
});
