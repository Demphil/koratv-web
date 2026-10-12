import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

const tables = ['channels', 'matches', 'channel_language_alternatives',
  'stream_access_audit', 'match_resource_assignments', 'live_matches'];
const [targetFile, backupDirectory] = process.argv.slice(2);
if (!targetFile || !backupDirectory) throw new Error('Target env file and private backup directory required');
const targetEnv = parseEnv(await readFile(targetFile, 'utf8'));
const source = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const target = { url: targetEnv.SUPABASE_URL, key: targetEnv.SUPABASE_SECRET_KEY };
if (new URL(source.url).hostname !== 'vzgldruuinbwslrfwjkb.supabase.co'
  || new URL(target.url).hostname !== 'amnguwuykrxvmwamlpjf.supabase.co') {
  throw new Error('Unexpected migration source or destination');
}
if (!source.key || !target.key) throw new Error('Server credentials missing');

async function request(client, table, query, options = {}) {
  const response = await fetch(`${client.url}/rest/v1/${table}?${query}`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: {
      apikey: client.key, Authorization: `Bearer ${client.key}`,
      'Content-Type': 'application/json', ...options.headers,
    },
  });
  // Never log response bodies: they may contain private channel URLs.
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  return response;
}

async function count(client, table) {
  const r = await request(client, table, 'select=*&limit=0', { headers: { Prefer: 'count=exact' } });
  const value = Number(r.headers.get('content-range')?.split('/')[1]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid count for ${table}`);
  return value;
}

async function readRows(client, table) {
  const rows = [];
  const primary = table === 'match_resource_assignments' ? 'match_id' : 'id';
  for (;;) {
    const response = await request(client, table,
      `select=*&order=${primary}.asc&limit=500&offset=${rows.length}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error(`Invalid data for ${table}`);
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

// Fail before writing anything if this is not an empty destination.
for (const table of tables) {
  if (await count(target, table) !== 0) throw new Error(`Destination ${table} is not empty`);
}
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const snapshots = new Map();
for (const table of tables) {
  const rows = await readRows(source, table);
  if (rows.length !== await count(source, table)) throw new Error(`Source changed: ${table}`);
  await writeFile(`${backupDirectory}/${table}.json`, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
  snapshots.set(table, rows);
}
const report = [];
for (const [table, rows] of snapshots) {
  for (let offset = 0; offset < rows.length; offset += 100) {
    await request(target, table, '', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows.slice(offset, offset + 100)),
    });
  }
  const copied = await readRows(target, table);
  if (digest(copied) !== digest(rows)) throw new Error(`Copy verification failed: ${table}`);
  if (digest(await readRows(source, table)) !== digest(rows)) throw new Error(`Source changed during copy: ${table}`);
  report.push({ table, rows: rows.length, verified: true, sha256: digest(rows) });
}
await writeFile(`${backupDirectory}/verified.json`, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ copied: true, sourceUnchanged: true, report }));
