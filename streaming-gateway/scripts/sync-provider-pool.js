import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { PROVIDER_IDS } from '../provider-pool.js';
import { credentialsFromCatalog, discoverProvider } from '../provider-direct.js';
import { applyProviderDiscovery } from '../provider-catalog-update.js';

const dir = process.env.PROVIDER_POOL_DIR || '/etc/koratv';
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: channels, error } = await client.from('channels').select('name').eq('active', true).limit(1000);
if (error) throw new Error('Canonical channel list unavailable');
let catalog = { providers: {}, channels: {} };
try { catalog = JSON.parse(await readFile(`${dir}/provider-catalog.json`, 'utf8')); } catch {}
catalog.providers ||= {}; catalog.channels ||= {};
let privateCredentials = {};
try { privateCredentials = JSON.parse(await readFile(`${dir}/provider-credentials.json`, 'utf8')); } catch {}

const report = [];
let refreshedProviders = 0;
const checkedAt = new Date().toISOString();
for (const id of PROVIDER_IDS) {
  const input = process.env[`IPTV_PROVIDER_${id}_JSON`];
  const credentials = input ? JSON.parse(input) : privateCredentials[id] || credentialsFromCatalog(catalog.providers[id]);
  if (!credentials?.username || !credentials?.password) {
    report.push({ provider: id, error: 'credentials_missing' });
    continue;
  }
  const origins = [...new Set((credentials.origins?.length ? credentials.origins : catalog.providers[id]?.origins || []).filter(Boolean))];
  if (!origins.length) { report.push({ provider: id, error: 'origins_missing' }); continue; }
  let discovered;
  try { discovered = await discoverProvider(credentials, origins, channels.map(x => x.name)); }
  catch (error) { discovered = { attempts: [{ error: error.message }], selected: [] }; }
  const update = applyProviderDiscovery(catalog, id, credentials, origins, discovered, checkedAt);
  if (update.replaced) refreshedProviders++;
  report.push({ provider: id, username: credentials.username, server: discovered.origin || null,
    providerStatus: discovered.info?.status || discovered.attempts?.at(-1)?.status || null,
    exp_date: discovered.info?.exp_date || discovered.attempts?.at(-1)?.exp_date || null,
    matchedChannels: update.replaced, retainedPrevious: update.retained, source: discovered.source || null,
    attempts: discovered.attempts });
}
if (!refreshedProviders) throw new Error('No provider catalog entries were refreshed; previous catalog retained');
catalog.updatedAt = checkedAt;
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(`${dir}/provider-catalog.json.tmp`, JSON.stringify(catalog, null, 2), { mode: 0o600 });
await rename(`${dir}/provider-catalog.json.tmp`, `${dir}/provider-catalog.json`);
await chmod(`${dir}/provider-catalog.json`, 0o600);
console.log(JSON.stringify({ updatedAt: catalog.updatedAt, accounts: report }));
