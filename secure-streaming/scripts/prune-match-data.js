import { obsoleteMatchRows } from '../../shared/match-broadcasts.mjs';

const MOROCCO_TIME_ZONE = 'Africa/Casablanca';
const DAILY_STATE_TABLES = [
  { table: 'match_route_state', column: 'route_date' },
  { table: 'match_resource_assignments', column: 'assignment_date' }
];

export function moroccoDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOROCCO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function isManagedMatchSource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  return normalized === 'api-football'
    || normalized === 'metascrape'
    || normalized.startsWith('kooora');
}

function isMissingTableError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST116|PGRST204|42P01|relation .* does not exist|schema cache/i.test(text);
}

export function staleDailyRows(rows = [], dateKey = moroccoDateKey()) {
  return rows.filter((row) => {
    if (!row?.id || row.active === false || !isManagedMatchSource(row.source)) return false;
    const kickoffKey = moroccoDateKey(row.kickoff_time);
    return kickoffKey && kickoffKey < dateKey;
  });
}

async function fetchRowsForDailyCleanup(supabase, table) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table)
      .select('id,source,kickoff_time,active,updated_at')
      .order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  return rows;
}

export async function deactivateRowsOutsideDailyWindow(supabase, table = 'matches', dateKey = moroccoDateKey()) {
  const rows = await fetchRowsForDailyCleanup(supabase, table);
  const stale = staleDailyRows(rows, dateKey);
  let deactivated = 0;
  for (const row of stale) {
    let query = supabase.from(table).update({ active: false }).eq('id', row.id);
    query = row.updated_at ? query.eq('updated_at', row.updated_at) : query.is('updated_at', null);
    const { data, error } = await query.select('id');
    if (error) throw error;
    deactivated += data?.length || 0;
  }
  return deactivated;
}

export async function deleteDailyStateOutsideDate(supabase, dateKey = moroccoDateKey()) {
  const results = {};
  for (const { table, column } of DAILY_STATE_TABLES) {
    const { data, error } = await supabase.from(table).delete().lt(column, dateKey).select(column);
    if (error) {
      if (isMissingTableError(error)) {
        results[table] = { deleted: 0, skipped: true };
        continue;
      }
      throw error;
    }
    results[table] = { deleted: data?.length || 0, skipped: false };
  }
  return results;
}

export async function runDailyRolloverCleanup(supabase, table = 'matches', { dateKey = moroccoDateKey() } = {}) {
  const deactivated = await deactivateRowsOutsideDailyWindow(supabase, table, dateKey);
  const state = await deleteDailyStateOutsideDate(supabase, dateKey);
  console.log(`Daily rollover: deactivated ${deactivated} old match rows for ${dateKey}; refreshed route state.`);
  return { dateKey, deactivated, state };
}

export async function pruneMatchData(supabase, table = 'matches', now = Date.now()) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table)
      .select('id,match_id,source,home_team,away_team,league,kickoff_time,updated_at,payload')
      .order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  const fresh = rows.filter((row) => ['kooora', 'api-football'].includes(row.source)
    && String(row.match_id || '').startsWith(`${row.source}_`)
    && Date.parse(row.payload?.broadcast?.checkedAt) > now - 30 * 60_000);
  const obsolete = obsoleteMatchRows(rows, fresh, now);
  let deleted = 0;
  for (const row of obsolete) {
    // Do not delete a record refreshed by another worker after this read.
    let query = supabase.from(table).delete().eq('id', row.id);
    query = row.updated_at ? query.eq('updated_at', row.updated_at) : query.is('updated_at', null);
    const { data, error } = await query.select('match_id');
    if (error) throw error;
    deleted += data.length;
  }
  const { error } = await supabase.from('channel_language_alternatives').delete()
    .lt('updated_at', new Date(now - 24 * 60 * 60_000).toISOString());
  if (error) throw error;
  console.log(`Match retention: deleted ${deleted} expired or superseded rows; channel inventory preserved.`);
  return deleted;
}
