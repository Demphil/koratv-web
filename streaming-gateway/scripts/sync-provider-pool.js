import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile, rename, chmod, access } from 'node:fs/promises';
import { matchChannels, normalizeName } from '../../secure-streaming/scripts/import-m3u.js';
import { selectProviderChannel } from '../provider-catalog.js';
import { fetchProviderArray } from '../provider-array.js';
import { PROVIDER_IDS } from '../provider-pool.js';

const dir = process.env.PROVIDER_POOL_DIR || '/etc/koratv';
const api = async (credentials, origin, action) => {
  const url = new URL('/player_api.php', origin);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  if (action) url.searchParams.set('action', action);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Provider catalog HTTP ${response.status}`);
  return response.json();
};
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: channels, error } = await client.from('channels').select('name,original_url').eq('active', true).limit(1000);
if (error) throw new Error('Primary channel catalog unavailable');
let catalog = { providers: {}, channels: {} };
try { catalog = JSON.parse(await readFile(`${dir}/provider-catalog.json`, 'utf8')); } catch {}
catalog.providers ||= {}; catalog.channels ||= {};
// Remove legacy account deadlines, including catalogs retained during a partial sync.
for (const id of PROVIDER_IDS) if (catalog.providers[id]) {
  const { expiresAt, firstActivatedAt, expirySource, ...retained } = catalog.providers[id];
  catalog.providers[id] = retained;
}
for (const row of channels) if (row.original_url) {
  catalog.channels[row.name] ||= {};
  catalog.channels[row.name].A = row.original_url;
}
const primary = channels.find(row => row.original_url)?.original_url;
if (primary) {
  const url = new URL(primary), parts = url.pathname.split('/').filter(Boolean);
  catalog.providers.A = { enabled: true, maxConnections: 1, id: 'Account_1_Primary', username: decodeURIComponent(parts[1]), server: url.origin, sourceUrl: primary };
}
const accountKeys = new Set();
for (const value of [...channels.map(row => row.original_url), ...Object.values(catalog.channels).map(row => row.A)]) {
  if (!value) continue;
  const parts = new URL(value).pathname.split('/').filter(Boolean);
  if (parts[0] === 'live') accountKeys.add(`${decodeURIComponent(parts[1])}:${decodeURIComponent(parts[2])}`);
}
for (const id of PROVIDER_IDS.slice(1)) {
  const input = process.env[`IPTV_PROVIDER_${id}_JSON`];
  if (!input) continue;
  const credentials = JSON.parse(input);
  if (!credentials.username || !credentials.password || !credentials.origins?.length) throw new Error(`Provider ${id} credentials missing`);
  const accountKey = `${credentials.username}:${credentials.password}`;
  if (accountKeys.has(accountKey)) throw new Error(`Provider ${id} must be an independent account`);
  accountKeys.add(accountKey);
  let origin, info;
  for (const host of credentials.origins) {
    try { const result = await api(credentials, host); if (Number(result.user_info?.auth) === 1) { origin = new URL(host).origin; info = result; break; } } catch {}
  }
  if (!info) {
    console.warn(`Provider ${id} authentication unavailable; saved catalog retained`);
    continue;
  }
  if (Number(info.user_info.max_connections) < 1) {
    console.warn(`Provider ${id} skipped: source reports no permitted connections; saved catalog retained`);
    continue;
  }
  const categoriesResult = await fetchProviderArray(api, credentials, origin, 'get_live_categories');
  if (!Array.isArray(categoriesResult)) {
    console.warn(`Provider ${id} skipped: get_live_categories remained invalid after retries`);
    continue;
  }
  const categories = categoriesResult;
  const sport = /sport|bein|arryadia|arriadia|ssc|alkass|الرياض|رياضي|الكأس|الكاس/i;
  const ids = new Set(categories.filter(c => c && typeof c === 'object' && sport.test(String(c.category_name || ''))).map(c => String(c.category_id)));
  const streamsResult = await fetchProviderArray(api, credentials, origin, 'get_live_streams');
  if (!Array.isArray(streamsResult)) {
    console.warn(`Provider ${id} skipped: get_live_streams remained invalid after retries`);
    continue;
  }
  const streams = streamsResult;
  const entries = streams.filter(s => s && typeof s === 'object' && (ids.has(String(s.category_id)) || sport.test(String(s.name || '')))).filter(s => /^\d+$/.test(String(s.stream_id)))
    .map(s => ({ name: String(s.name || ''), rawName: String(s.name || ''), group: categories.find(c => c && String(c.category_id) === String(s.category_id))?.category_name || '',
      url: new URL(`/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${s.stream_id}.m3u8`, origin).href }))
    .map(entry => ({ ...entry, search: normalizeName(`${entry.name} ${entry.group}`) }));
  const selected = matchChannels(channels.map(c => c.name), entries, { candidatesPerChannel: 30 })
    .map(match => ({ name: match.name, chosen: selectProviderChannel(match) })).filter(row => row.chosen);
  if (!selected.length) {
    console.warn(`Provider ${id} skipped: no sports channels matched; saved catalog retained`);
    continue;
  }
  for (const row of Object.values(catalog.channels)) { delete row[id]; if (row.sourceNames) delete row.sourceNames[id]; }
  for (const { name, chosen } of selected) {
    catalog.channels[name] ||= {};
    catalog.channels[name][id] = chosen.original_url;
    catalog.channels[name].sourceNames ||= {};
    catalog.channels[name].sourceNames[id] = chosen.source_name;
  }
  catalog.providers[id] = { enabled: true, maxConnections: 1,
    id: `Account_${PROVIDER_IDS.indexOf(id) + 1}_${credentials.username}`, username: credentials.username, server: origin,
    sourceUrl: selected[0].chosen.original_url };
  console.log(JSON.stringify({ provider: id, max_connections: info.user_info.max_connections, active_cons: info.user_info.active_cons,
    sportsChannels: entries.length, matchedChannels: selected.length, mapped: selected.map(({name,chosen}) => ({channel:name,source:chosen.source_name})) }));
}
catalog.updatedAt = new Date().toISOString();
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
