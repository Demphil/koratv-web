import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const settings = { ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
const base = settings.SUPABASE_URL || settings.NEXT_PUBLIC_SUPABASE_URL;
const key = settings.SUPABASE_SECRET_KEY || settings.SUPABASE_SERVICE_ROLE_KEY || settings.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error('Supabase URL and key are required');
const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
async function upsert(table, record, conflict) {
  const url = new URL(`/rest/v1/${table}`, base);
  url.searchParams.set('on_conflict', conflict);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(record), signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    console.error(`${table}: HTTP ${response.status}, code ${result.code || 'unknown'}`);
    if (result.code === 'PGRST205') console.error('Table is missing. Apply supabase/live_matches.sql and supabase/stream_sources.sql first.');
    else if ([401, 403].includes(response.status)) console.error('Current key cannot write. Use a server-only secret key or the SQL Editor; do not disable RLS.');
    process.exitCode = 1;
    return false;
  }
  console.log(`${table}: upsert succeeded`);
  return true;
}
// Optionally set TEST_STREAM_URL and TEST_STREAM_ORIGINS in the private environment.
if (settings.TEST_STREAM_URL) {
  const source = new URL(settings.TEST_STREAM_URL);
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Use an HTTPS source without embedded credentials');
  const origins = [...new Set([source.origin, ...(settings.TEST_STREAM_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)])];
  if (origins.some((value) => new URL(value).origin !== value || !value.startsWith('https://'))) throw new Error('Stream origins must be exact HTTPS origins');
  if (!await upsert('stream_sources', { channel_id: 'ch1', stream_url: source.href, allowed_origins: origins }, 'channel_id')) process.exit(1);
}
await upsert('live_matches', { id: 'match-01', channel_id: 'ch1', is_streaming_active: true }, 'id');
