import { readFile } from 'node:fs/promises';
import { isCatalogChannelSourceVerified } from '../../shared/provider-channel-match.mjs';

const dir = process.env.PROVIDER_POOL_DIR || '/etc/koratv';
const catalog = JSON.parse(await readFile(`${dir}/provider-catalog.json`, 'utf8'));
const mappings = [];
let blockedLegacy = 0;
for (const [channel, row] of Object.entries(catalog.channels || {})) {
  if (!/\bbein\b/i.test(channel)) continue;
  for (const [provider, account] of Object.entries(catalog.providers || {})) {
    if (!account.enabled || !row[provider]) continue;
    if (!isCatalogChannelSourceVerified(channel, row, provider)) { blockedLegacy++; continue; }
    if (!/^beIN SPORTS HD [123]$/i.test(channel)) continue;
    mappings.push({ channel, provider, sourceName: row.sourceNames?.[provider], group: row.sourceGroups?.[provider] || '' });
  }
}
// Only channel identity metadata is printed; no URLs, origins or account credentials.
console.log(JSON.stringify({ channelMappingAudit: { mappings, blockedLegacy } }));
