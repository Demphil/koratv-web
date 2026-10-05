import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { isProviderChannelCompatible, CHANNEL_MATCH_POLICY_VERSION } from '../../shared/provider-channel-match.mjs';
import { PROVIDER_IDS } from '../provider-pool.js';

const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const path = process.env.PROVIDER_CATALOG_PATH || '/etc/koratv/provider-catalog.json';
const catalog = JSON.parse(await readFile(path, 'utf8'));
const entry = catalog.channels[input.name] ||= {};
for (const [id, url] of Object.entries(input.sources)) {
  const source = input.names[id];
  if (!PROVIDER_IDS.includes(id) || !catalog.providers[id]?.enabled || !source
    || !isProviderChannelCompatible(input.name, source) || !/^https?:$/.test(new URL(url).protocol)) throw new Error('Invalid prepared channel');
  entry[id] = url;
  (entry.sourceNames ||= {})[id] = source.name;
  (entry.sourceGroups ||= {})[id] = source.group;
  (entry.sourcePolicyVersions ||= {})[id] = CHANNEL_MATCH_POLICY_VERSION;
  (entry.mediaVerifiedNames ||= {})[id] = source.name;
}
catalog.updatedAt = new Date().toISOString();
const temporary = `${path}.operator-${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(catalog), { mode: 0o600 });
await rename(temporary, path);
await unlink(process.argv[2]);
