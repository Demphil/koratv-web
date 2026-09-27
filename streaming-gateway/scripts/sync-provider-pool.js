import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile, rename, chmod, access } from 'node:fs/promises';
import { matchChannels } from '../../secure-streaming/scripts/import-m3u.js';

const dir = process.env.PROVIDER_POOL_DIR || '/etc/koratv';
const credentials = JSON.parse(process.env.IPTV_PROVIDER_B_JSON || '{}');
const origins = credentials.origins || [];
if (!credentials.username || !credentials.password || !origins.length) throw new Error('Provider B credentials missing');
const api = async (origin, action) => {
  const url = new URL('/player_api.php', origin);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  if (action) url.searchParams.set('action', action);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Provider B catalog HTTP ${response.status}`);
  return response.json();
};
let origin, info;
for (const host of origins) {
  try { const result = await api(host); if (Number(result.user_info?.auth) === 1) { origin = new URL(host).origin; info = result; break; } } catch {}
}
if (!info) throw new Error('Provider B authentication unavailable on configured origins');
const expiresAt = Number(info.user_info.exp_date) * 1000;
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Provider B has expired');
if (Number(info.user_info.max_connections) !== 1) throw new Error('Provider B connection policy differs from expected one-slot account');
const categories = await api(origin, 'get_live_categories');
const sport = /sport|bein|arryadia|arriadia|ssc|alkass|الرياض|رياضي|الكأس|الكاس/i;
const ids = new Set(categories.filter(c => sport.test(c.category_name)).map(c => String(c.category_id)));
const streams = await api(origin, 'get_live_streams');
const entries = streams.filter(s => ids.has(String(s.category_id)) || sport.test(s.name)).filter(s => /^\d+$/.test(String(s.stream_id)))
  .map(s => ({ name: s.name, rawName: s.name, group: categories.find(c => String(c.category_id) === String(s.category_id))?.category_name || '',
    url: new URL(`/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${s.stream_id}.m3u8`, origin).href }));
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: channels, error } = await client.from('channels').select('name,original_url').eq('active', true).limit(1000);
if (error) throw new Error('Primary channel catalog unavailable');
for (const row of channels) {
  if (!row.original_url) continue;
  const parts = new URL(row.original_url).pathname.split('/').filter(Boolean);
  if (parts.includes(credentials.username) && parts.includes(credentials.password)) throw new Error('Provider A and B must be independent accounts');
}
const matched = matchChannels(channels.map(c => c.name), entries, { candidatesPerChannel: 30 });
const qualityRank = candidate => /\b(?:4k|uhd|fhd|1080p)\b/i.test(candidate.source_name) ? 1 : /\b(?:hd|720p)\b/i.test(candidate.source_name) ? 0 : 2;
const catalog = { updatedAt: new Date().toISOString(), providers: { B: { enabled: true, maxConnections: 1, expiresAt: new Date(expiresAt).toISOString() } }, channels: {} };
for (const match of matched) {
  const chosen = [...match.candidates].sort((a, b) => qualityRank(a) - qualityRank(b) || a.source_name.localeCompare(b.source_name))[0];
  catalog.channels[match.name] = { B: chosen.original_url, sourceName: chosen.source_name };
}
if (!matched.length) throw new Error('No sports channels matched; existing pool catalog preserved');
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(`${dir}/provider-catalog.json.tmp`, JSON.stringify(catalog, null, 2), { mode: 0o600 });
await rename(`${dir}/provider-catalog.json.tmp`, `${dir}/provider-catalog.json`);
await chmod(`${dir}/provider-catalog.json`, 0o600);
try { await access(`${dir}/manual-broadcast-override.json`); } catch {
  await writeFile(`${dir}/manual-broadcast-override.json`, '{"matches":{}}\n', { mode: 0o600 });
}
const envPath = new URL('../.env', import.meta.url);
let envText = await readFile(envPath, 'utf8');
const values = { PROVIDER_POOL_ENABLED: 'true', PROVIDER_CATALOG_PATH: `${dir}/provider-catalog.json`, MANUAL_BROADCAST_OVERRIDE_PATH: `${dir}/manual-broadcast-override.json`, CHECK_PLAYBACK_SOURCE_HEALTH: 'false', CHECK_MATCH_SOURCE_HEALTH: 'false' };
envText = envText.split(/\r?\n/).filter(line => !Object.keys(values).some(key => line.startsWith(`${key}=`))).join('\n');
await writeFile(envPath, `${envText}\n${Object.entries(values).map(([key,value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
const syncEnvPath = new URL('../../secure-streaming/.env', import.meta.url);
const syncEnv = (await readFile(syncEnvPath, 'utf8')).split(/\r?\n/).filter(line => !/^(PROVIDER_POOL_ENABLED|IPTV_VALIDATE_STREAMS|IPTV_SYNC_MASTER_QUALITIES)=/.test(line));
await writeFile(syncEnvPath, `${syncEnv.join('\n')}\nPROVIDER_POOL_ENABLED=true\nIPTV_VALIDATE_STREAMS=false\nIPTV_SYNC_MASTER_QUALITIES=false\n`, { mode: 0o600 });
console.log(JSON.stringify({ provider: 'B', max_connections: info.user_info.max_connections, active_cons: info.user_info.active_cons,
  expiresAt: catalog.providers.B.expiresAt, sportsChannels: entries.length, matchedChannels: matched.length,
  mapped: matched.map(item => ({ channel: item.name, source: catalog.channels[item.name].sourceName })) }));
