import { mkdir, writeFile, rename, chmod } from 'node:fs/promises';
const text = (value, limit = 120) => typeof value === 'string' ? value.slice(0, limit) : '';
const logo = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};
export function publicMetadataRow(row) {
  const p = row.payload || {};
  const payload = Object.fromEntries(['score', 'status', 'time', 'homeTeamEnglish', 'awayTeamEnglish', 'leagueCountry']
    .filter(key => typeof p[key] === 'string').map(key => [key, text(p[key])]));
  for (const key of ['isLive', 'isFinished']) if (typeof p[key] === 'boolean') payload[key] = p[key];
  for (const key of ['liveMinute', 'liveExtraMinute', 'sourceFixtureId', 'leagueId', 'homeTeamId', 'awayTeamId']) {
    if (Number.isSafeInteger(Number(p[key])) && p[key] !== null) payload[key] = Number(p[key]);
  }
  for (const key of ['homeLogo', 'awayLogo']) payload[key] = logo(p[key]);
  for (const key of ['homeTeamEnglishAliases', 'awayTeamEnglishAliases']) if (Array.isArray(p[key])) payload[key] = p[key].slice(0, 8).map(value => text(value, 90));
  payload.statistics = (Array.isArray(p.statistics) ? p.statistics : []).slice(0, 2).map(group => ({
    team: { name: text(group.team?.name), logo: logo(group.team?.logo) },
    statistics: (Array.isArray(group.statistics) ? group.statistics : []).slice(0, 60).map(item => ({
      type: text(item.type), value: typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : text(item.value, 100),
    })),
  }));
  payload.goals = (Array.isArray(p.goals) ? p.goals : []).slice(0, 50).map(item => ({
    player: text(item.player), minute: text(String(item.minute ?? ''), 12), team: ['home', 'away'].includes(item.team) ? item.team : '',
  }));
  payload.events = (Array.isArray(p.events) ? p.events : []).slice(0, 80).map(item => ({
    player: text(item.player), type: text(item.type), detail: text(item.detail), minute: text(String(item.minute ?? ''), 12),
  }));
  return { id: text(row.id, 200), match_id: text(row.match_id, 200), source: text(row.source, 40),
    home_team: text(row.home_team), away_team: text(row.away_team), league: text(row.league),
    kickoff_time: row.kickoff_time, updated_at: row.updated_at, active: row.active === true, payload };
}

export async function writePublicSnapshot(client, { directory = '/var/lib/koratv-site-publish' } = {}) {
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data, error } = await client.from('matches').select('*').eq('active', true)
      .order('kickoff_time').order('id').range(offset, offset + 499);
    if (error || !Array.isArray(data)) throw Error('Public metadata snapshot read failed');
    rows.push(...data.map(publicMetadataRow));
    if (data.length < 500) break;
    if (offset === 4500) throw Error('Public metadata row limit');
  }
  const encoded = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), matches: rows });
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) throw Error('Public metadata size limit');
  await mkdir(directory, { recursive: true, mode: 0o755 });
  await chmod(directory, 0o755);
  const temporary = `${directory}/matches.${process.pid}.tmp`;
  await writeFile(temporary, encoded, { mode: 0o644 });
  // The ingest service's private umask must not hide this explicitly public allowlist.
  await chmod(temporary, 0o644);
  await rename(temporary, `${directory}/matches.json`);
  return rows.length;
}
