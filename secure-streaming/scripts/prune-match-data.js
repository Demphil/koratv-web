import { obsoleteMatchRows } from '../../shared/match-broadcasts.mjs';

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
