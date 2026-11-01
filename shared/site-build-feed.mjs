export async function loadPublicSiteMatches({ siteUrl, fetchImpl = fetch, now = Date.now() } = {}) {
  const url = process.env.SITE_MATCHES_SNAPSHOT_URL || 'https://stream-api.koratv.click/site-metadata/matches.json';
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw Error('A public HTTPS match snapshot is required');
  const response = await fetchImpl(target, { headers: { Origin: siteUrl, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Public match snapshot unavailable (${response.status})`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw Error('Public match snapshot exceeds size limit');
  const data = JSON.parse(body), age = now - Date.parse(data.generatedAt);
  if (data.version !== 1 || !Array.isArray(data.matches) || data.matches.length > 5000
    || !Number.isFinite(age) || age < -300000 || age > 6 * 3600000) throw Error('Invalid or stale public match snapshot');
  return data.matches.filter(row => {
    const kickoff = Date.parse(row.kickoff_time);
    return row.active !== false && Number.isFinite(kickoff) && kickoff >= now - 7 * 86400000 && kickoff <= now + 14 * 86400000;
  });
}
