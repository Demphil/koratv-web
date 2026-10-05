import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac, randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const moduleAt = name => import(pathToFileURL(resolve(process.cwd(), name)).href);
const { createProviderCatalog } = await moduleAt('provider-catalog.js');
const { credentialsFromCatalog, discoverProvider } = await moduleAt('provider-direct.js');
const { isProviderChannelCompatible } = await moduleAt('../shared/provider-channel-match.mjs');
const catalog = createProviderCatalog(process.env);
const dir = process.env.PROVIDER_POOL_DIR || '/etc/koratv';
const authorization = `Bearer ${createHmac('sha256', process.env.HMAC_SECRET).update('koratv-account-admin-v1').digest('hex')}`;
const status = async () => (await (await fetch('http://127.0.0.1:3100/internal/accounts-status', { headers: { authorization } })).json()).accounts;
let credentials = {};
try { credentials = JSON.parse(await readFile(`${dir}/provider-credentials.json`, 'utf8')); } catch {}
const targets = [['B', 'beIN SPORTS HD 1'], ['D', 'beIN SPORTS HD 4']];
async function installVerified(provider, channel, chosen) {
  const file = `${dir}/verified-repair-${randomUUID()}.json`;
  await writeFile(file, JSON.stringify({ name: channel, sources: { [provider]: chosen.original_url }, names: { [provider]: { name: chosen.source_name, group: chosen.group || '' } } }), { mode: 0o600 });
  try { await execute('flock', ['-w', '45', `${dir}/provider-catalog.lock`, process.execPath, 'scripts/operator-catalog-install.mjs', file], { timeout: 50000 }); }
  finally { await unlink(file).catch(() => {}); }
}
for (const [provider, channel] of targets) {
  const state = (await status()).find(row => row.provider === provider);
  const entry = catalog.channels()[channel];
  const compatible = isProviderChannelCompatible(channel, { name: entry?.sourceNames?.[provider] || '', group: entry?.sourceGroups?.[provider] || '' });
  if (state?.current_channel === channel && state.last_http_code === 200 && compatible) {
    await installVerified(provider, channel, { original_url: entry[provider], source_name: entry.sourceNames[provider], group: entry.sourceGroups?.[provider] });
    console.log(JSON.stringify({ provider, channel, skipped: 'working_account', preferenceSaved: true })); continue;
  }
  if (state?.current_channel && state.current_channel !== channel) {
    console.log(JSON.stringify({ provider, channel, skipped: 'busy_other_channel' })); continue;
  }
  const account = catalog.accounts()[provider];
  const input = credentials[provider] || credentialsFromCatalog(account);
  if (!input || !account?.enabled) continue;
  const origins = [...new Set([...(input.origins || []), ...(account.origins || [])])];
  let probes = 0;
  const deadline = Date.now() + 120000;
  const result = await discoverProvider(input, origins, [channel], { retry: 1,
    verifySource: async chosen => {
      if (++probes > 12 || Date.now() >= deadline) return false;
      const signal = AbortSignal.timeout(8000);
      let url = new URL(chosen.original_url);
      try {
        for (let depth = 0; depth < 3; depth++) {
          const response = await fetch(url, { headers: { 'User-Agent': 'IPTVSmartersPlayer', Accept: '*/*' }, signal });
          if (!response.ok) { await response.body?.cancel(); console.log(JSON.stringify({ provider, channel, probe: probes, status: response.status })); return false; }
          const text = await response.text();
          if (!text.trimStart().startsWith('#EXTM3U')) return false;
          const lines = text.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
          if (!lines.length) return false;
          const base = response.url || url;
          if (text.includes('#EXT-X-STREAM-INF:')) { url = new URL(lines[0], base); continue; }
          const media = await fetch(new URL(lines.at(-1), base), { headers: { 'User-Agent': 'IPTVSmartersPlayer' }, signal });
          const reader = media.body?.getReader();
          const bytes = await reader?.read(); await reader?.cancel();
          const ok = media.ok && Boolean(bytes?.value?.length);
          console.log(JSON.stringify({ provider, channel, probe: probes, ok, status: media.status, variant: chosen.source_name }));
          return ok;
        }
      } catch (error) { console.log(JSON.stringify({ provider, channel, probe: probes, error: error.name })); }
      return false;
    }
  });
  const chosen = result.selected?.[0]?.chosen;
  if (!chosen) { console.log(JSON.stringify({ provider, channel, repaired: false, probes })); continue; }
  await installVerified(provider, channel, chosen);
  console.log(JSON.stringify({ provider, channel, repaired: true, probes, variant: chosen.source_name }));
}
