import { fileURLToPath } from 'node:url';
import { fetchHtml, parseKoooraMatches, enrichKoooraRowsWithScheduleChannels, enrichKoooraRowsWithDetailChannels, upsertMatchRows } from './sync-matches-from-source.js';
import { validateMatchSearch, findRequestedMatches } from '../../shared/operator-match-search.mjs';
import { reconcileBroadcasts } from '../../shared/match-broadcasts.mjs';
import { sourceMatchState } from '../../shared/match-lifecycle.mjs';

export async function runOperatorMatchImport(mode, input, dependencies = {}) {
  const query = validateMatchSearch(input);
  if (input.day && input.day !== query.day) throw new Error('search_expired');
  const load = dependencies.load || (async () => parseKoooraMatches(await fetchHtml('https://www.kooora.com/كرة-القدم/مباريات-اليوم'), { includeAll: true }));
  const rows = findRequestedMatches(await load(), query);
  if (mode === 'search') return { query, matches: rows.slice(0, 12) };
  if (mode !== 'import') throw new Error('invalid_match');
  const selected = rows.find(row => row.match_id === input.matchId && row.payload?.sourceMatchId === input.sourceMatchId);
  if (!selected) throw new Error('match_not_found');
  if (['ended', 'unavailable'].includes(sourceMatchState(selected.payload)) || selected.active === false) throw new Error('match_not_broadcastable');
  const enrich = dependencies.enrich || (async rows => { await enrichKoooraRowsWithScheduleChannels(rows); await enrichKoooraRowsWithDetailChannels(rows); });
  await enrich([selected]);
  const [row] = reconcileBroadcasts([selected]);
  row.payload.operatorImport = { source: 'operator-console', matchId: row.match_id, sourceMatchId: row.payload.sourceMatchId, day: query.day, importedAt: new Date().toISOString() };
  await (dependencies.persist || (rows => upsertMatchRows(rows, { prune: false })))([row]);
  return { match: row };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const log = console.log;
  console.log = (...args) => console.error(...args);
  runOperatorMatchImport(process.argv[2], JSON.parse(process.argv[3] || '{}'))
    .then(result => log(JSON.stringify(result)))
    .catch(error => { log(JSON.stringify({ error: ['invalid_team_names', 'search_expired', 'match_not_found', 'match_not_broadcastable', 'invalid_match'].includes(error.message) ? error.message : 'source_search_failed' })); process.exitCode = 1; });
}
