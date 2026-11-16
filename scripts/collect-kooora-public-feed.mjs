import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml, koooraTodayUrl, parseKoooraMatches, enrichKoooraRowsWithScheduleChannels } from '../secure-streaming/scripts/sync-matches-from-source.js';
import { publicMetadataRow } from '../site-data/public-snapshot.mjs';

function moroccoDateKey(offsetDays = 0, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function writeKoooraSnapshot(rows, {
  outputPath = resolve(process.env.SITE_MATCHES_SNAPSHOT_FILE || 'site-data/generated/matches.json'), now = Date.now
} = {}) {
  const matches = rows.map(publicMetadataRow).filter(row => row.source === 'kooora' && row.active);
  if (!matches.length) throw new Error('Kooora returned no active matches; the previous published feed is preserved.');
  if (matches.length > 5000) throw new Error('Kooora feed exceeds the match limit.');
  const body = JSON.stringify({ version: 1, generatedAt: new Date(now()).toISOString(), matches });
  if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error('Kooora feed exceeds the public snapshot size limit.');
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o644 });
  await rename(temporary, outputPath);
  return { count: matches.length, outputPath };
}

export async function collectKoooraPublicFeed({
  fetch = fetchHtml,
  parse = parseKoooraMatches,
  enrich = enrichKoooraRowsWithScheduleChannels,
  write = writeKoooraSnapshot,
  now = new Date()
} = {}) {
  const dates = [moroccoDateKey(0, now), moroccoDateKey(1, now)];
  const rows = [];
  for (const date of dates) {
    const html = await fetch(koooraTodayUrl(date));
    rows.push(...parse(html, { expectedDate: date }));
  }
  if (!rows.length) throw new Error('Kooora returned no matches for today or tomorrow.');
  await enrich(rows);
  const result = await write(rows);
  console.log(JSON.stringify({ event: 'kooora_public_feed_written', dates, matches: result.count }));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectKoooraPublicFeed().catch(error => {
    console.error(`[kooora-public-feed] ${error.message}`);
    process.exitCode = 1;
  });
}

