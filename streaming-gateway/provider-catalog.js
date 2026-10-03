import { readFileSync, statSync } from 'node:fs';
import { findChannelNameMatch, createChannelNameMatcher } from '../shared/channel-name-match.mjs';
import { normalizeName, beinRegion, isProviderChannelCompatible, isCatalogChannelSourceVerified } from '../shared/provider-channel-match.mjs';
import { PROVIDER_IDS } from './provider-pool.js';

export function selectProviderChannel(match) {
  const qualityRank = candidate => /\b(?:4k|uhd|fhd|1080p)\b/i.test(candidate.source_name) ? 1 : /\b(?:hd|720p)\b/i.test(candidate.source_name) ? 0 : 2;
  const providerNameMatches = (sourceName) => {
    if (findChannelNameMatch(match.name, [sourceName]) === sourceName) return true;
    const requestedWords = normalizeName(match.name).split(/\s+/).filter(Boolean);
    const sourceWords = new Set(normalizeName(sourceName).split(/\s+/).filter(Boolean));
    return requestedWords.length > 0 && requestedWords.every((word) => sourceWords.has(word));
  };
  return [...(match.candidates || [])]
    .filter(candidate => providerNameMatches(candidate.source_name)
      && isProviderChannelCompatible(match.name, { name: candidate.source_name, group: candidate.group || '' }))
    .sort((a, b) => Number(beinRegion(`${b.source_name} ${b.group || ''}`) === 'ar')
      - Number(beinRegion(`${a.source_name} ${a.group || ''}`) === 'ar')
      || qualityRank(a) - qualityRank(b) || a.source_name.localeCompare(b.source_name))[0] || null;
}

export function createProviderCatalog(env = process.env) {
  let catalog = { channels: {} }, overrides = { matches: {} }, routeState = { matches: {} }, activeCatalog = { matches: {} }, assignments = { assignments: [], ignored: [] }, checked = 0;
  const fileVersions = new Map();
  const resolvedNames = new Map();
  let sourceAliases = [], channelAliases = [];
  let sourceMatcher = () => null, channelMatcher = () => null;
  const loadChanged = (path, previous) => {
    try {
      const stat = statSync(path);
      const version = `${stat.mtimeMs}:${stat.size}`;
      if (fileVersions.get(path) === version) return previous;
      const value = JSON.parse(readFileSync(path, 'utf8'));
      fileVersions.set(path, version);
      return value;
    } catch { return previous; }
  };
  const hasEnabledSources = (name) => PROVIDER_IDS.some((id) => catalog.providers?.[id]?.enabled
    && catalog.channels?.[name]?.[id] && isCatalogChannelSourceVerified(name, catalog.channels[name], id));
  const assignmentFor = (matchId) => {
    const id = String(matchId || '').trim();
    if (!id) return null;
    const assignedIndex = (assignments.assignments || []).findIndex((item) => String(item?.matchId || '') === id || item?.aliases?.includes(id));
    const assigned = assignments.assignments?.[assignedIndex];
    if (assigned?.providerId && assigned?.resolvedChannel) {
      return {
        matchId: id,
        status: 'ASSIGNED',
        providerId: String(assigned.providerId),
        requestedChannel: assigned.requestedChannel || null,
        resolvedChannel: String(assigned.resolvedChannel).trim(),
        priorityScore: Number(assigned.priorityScore || 0),
        broadcastRank: assignedIndex + 1,
        manual: assigned.manual === true,
        source: 'match-resource-assignment',
      };
    }
    const ignored = (assignments.ignored || []).find((item) => String(item?.matchId || '') === id || item?.aliases?.includes(id));
    if (ignored) {
      return {
        matchId: id,
        status: 'WAITING',
        providerId: null,
        requestedChannel: ignored.requestedChannel || null,
        resolvedChannel: ignored.resolvedChannel || null,
        priorityScore: Number(ignored.priorityScore || 0),
        source: 'match-resource-assignment',
      };
    }
    return null;
  };
  const refresh = (force = false) => {
    if (!force && Date.now() - checked < 5000) return;
    checked = Date.now();
    const previous = catalog;
    catalog = loadChanged(env.PROVIDER_CATALOG_PATH || '/etc/koratv/provider-catalog.json', catalog);
    if (catalog !== previous) {
      resolvedNames.clear();
      sourceAliases = [];
      channelAliases = [];
      for (const [name, entry] of Object.entries(catalog.channels || {})) {
        if (!hasEnabledSources(name)) continue;
        channelAliases.push({ alias: name, name });
        for (const [id, sourceName] of Object.entries(entry?.sourceNames || {})) {
          if (sourceName && catalog.providers?.[id]?.enabled && entry[id]
            && isCatalogChannelSourceVerified(name, entry, id)) sourceAliases.push({ alias: sourceName, name });
        }
      }
      sourceMatcher = createChannelNameMatcher(sourceAliases.map(row => row.alias));
      channelMatcher = createChannelNameMatcher(channelAliases.map(row => row.alias));
    }
    overrides = loadChanged(env.MANUAL_BROADCAST_OVERRIDE_PATH || '/etc/koratv/manual-broadcast-override.json', overrides);
    routeState = loadChanged(env.DIRECT_MATCH_ROUTE_STATE_PATH || '/etc/koratv/direct-match-route-state.json', routeState);
    activeCatalog = loadChanged(env.ACTIVE_CATALOG_PATH || '/etc/koratv/active-catalog.json', activeCatalog);
    assignments = loadChanged(env.MATCH_RESOURCE_ASSIGNMENT_PATH || '/etc/koratv/match-resource-assignments.json', assignments);
  };
  const resolve = (channel) => {
    refresh();
    const requested = String(channel || '').trim();
    if (!requested) return null;
    if (catalog.channels?.[requested] && hasEnabledSources(requested)) return requested;
    if (resolvedNames.has(requested)) return resolvedNames.get(requested);
    const matchRows = (rows, matcher) => {
      const matched = matcher(requested);
      if (!matched) return null;
      const matches = rows.filter((row) => row.alias === matched);
      const names = [...new Set(matches.map((row) => row.name).filter(hasEnabledSources))];
      return names.length === 1 ? names[0] : null;
    };
    const result = matchRows(sourceAliases, sourceMatcher) || matchRows(channelAliases, channelMatcher);
    if (resolvedNames.size >= 1000) resolvedNames.delete(resolvedNames.keys().next().value);
    resolvedNames.set(requested, result);
    return result;
  };
  return {
    refreshNow() { checked = 0; refresh(true); },
    accounts() { refresh(); return catalog.providers || {}; },
    channels() { refresh(); return catalog.channels || {}; },
    resolve,
    matchAssignment(matchId) {
      refresh();
      return assignmentFor(matchId);
    },
    assignments() {
      refresh();
      return {
        generatedAt: assignments.generatedAt || null,
        date: assignments.date || null,
        assignments: Array.isArray(assignments.assignments) ? assignments.assignments : [],
        ignored: Array.isArray(assignments.ignored) ? assignments.ignored : []
      };
    },
    matchRoute(matchId) {
      refresh();
      const id = String(matchId || '').trim();
      if (!id) return null;
      const direct = routeState.matches?.[id];
      if (direct?.status === 'RESOLVED' && typeof direct.resolvedChannel === 'string' && direct.resolvedChannel.trim()) {
        return {
          matchId: id,
          requestedChannels: Array.isArray(direct.requestedChannels) ? direct.requestedChannels : [direct.requestedChannel].filter(Boolean),
          resolvedChannel: direct.resolvedChannel.trim(),
          providerIds: Array.isArray(direct.providerIds) ? direct.providerIds.filter(Boolean) : [],
          status: direct.status,
          source: 'direct-match-route-state',
        };
      }
      const active = activeCatalog.matches?.[id];
      const route = Array.isArray(active?.routes) ? active.routes[0] : null;
      if (route?.channel) {
        return {
          matchId: id,
          requestedChannels: Array.isArray(active.requestedNames) ? active.requestedNames : [],
          resolvedChannel: route.channel,
          status: 'RESOLVED',
          source: 'active-catalog',
        };
      }
      return null;
    },
    override(matchId) {
      refresh(); const item = overrides.matches?.[matchId];
      if (!item || item.enabled === false || !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now()) return null;
      return typeof item.channel === 'string' ? item.channel : null;
    },
    sources(channel) {
      refresh(); const resolved = resolve(channel), sources = {};
      for (const id of PROVIDER_IDS) {
        if (resolved && catalog.providers?.[id]?.enabled && catalog.channels?.[resolved]?.[id]
          && isCatalogChannelSourceVerified(resolved, catalog.channels[resolved], id)
          && isProviderChannelCompatible(channel, { name: catalog.channels[resolved].sourceNames?.[id] || resolved,
            group: catalog.channels[resolved].sourceGroups?.[id] || '' })) sources[id] = catalog.channels[resolved][id];
      }
      return sources;
    },
  };
}
