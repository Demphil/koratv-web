import { PROVIDER_IDS } from './provider-pool.js';
import { CHANNEL_MATCH_POLICY_VERSION, isProviderChannelCompatible } from '../shared/provider-channel-match.mjs';

export function applyProviderDiscovery(catalog, id, credentials, origins, discovered, checkedAt) {
  const previous = catalog.providers[id] || {};
  const noCapacity = discovered.info?.max_connections != null
    && Number(discovered.info.max_connections) < 1;
  const selected = noCapacity ? [] : (discovered.selected || []).filter(({ name, chosen }) => chosen
    && isProviderChannelCompatible(name, { name: chosen.source_name, group: chosen.group || '' }));
  const status = discovered.info?.status
    || discovered.attempts?.find(attempt => attempt.status)?.status || null;
  const expired = /^(expired|disabled|banned)$/i.test(status || '');

  if (!selected.length) {
    catalog.providers[id] = {
      ...previous,
      enabled: !expired && !noCapacity && previous.username === credentials.username && Boolean(previous.enabled),
      syncStatus: expired || noCapacity ? 'UNAVAILABLE' : 'STALE',
      lastSyncAt: checkedAt,
    };
    return { replaced: 0, retained: true, status };
  }

  for (const row of Object.values(catalog.channels)) {
    if (!row || typeof row !== 'object') continue;
    delete row[id];
    if (row.sourceNames) delete row.sourceNames[id];
    if (row.sourceGroups) delete row.sourceGroups[id];
    if (row.sourcePolicyVersions) delete row.sourcePolicyVersions[id];
  }
  for (const { name, chosen } of selected) {
    catalog.channels[name] ||= {};
    catalog.channels[name][id] = chosen.original_url;
    catalog.channels[name].sourceNames ||= {};
    catalog.channels[name].sourceNames[id] = chosen.source_name;
    catalog.channels[name].sourceGroups ||= {};
    catalog.channels[name].sourceGroups[id] = chosen.group || '';
    catalog.channels[name].sourcePolicyVersions ||= {};
    catalog.channels[name].sourcePolicyVersions[id] = CHANNEL_MATCH_POLICY_VERSION;
  }
  catalog.providers[id] = {
    enabled: true,
    maxConnections: Number(discovered.info?.max_connections || previous.maxConnections || 0),
    slotLimit: 1,
    id: previous.id || (id === 'A' ? 'Account_1_Primary' : `Account_${PROVIDER_IDS.indexOf(id) + 1}_${credentials.username}`),
    username: credentials.username,
    server: discovered.origin || previous.server || origins[0],
    origins,
    sourceUrl: selected[0].chosen.original_url,
    syncStatus: 'READY',
    lastSyncAt: checkedAt,
  };
  return { replaced: selected.length, retained: false, status };
}
