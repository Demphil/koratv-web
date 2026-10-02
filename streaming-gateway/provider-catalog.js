import { readFileSync } from 'node:fs';
import { findChannelNameMatch } from '../shared/channel-name-match.mjs';
import { normalizeName } from '../shared/provider-channel-match.mjs';
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
    .filter(candidate => providerNameMatches(candidate.source_name))
    .sort((a, b) => qualityRank(a) - qualityRank(b) || a.source_name.localeCompare(b.source_name))[0] || null;
}

export function createProviderCatalog(env = process.env) {
  let catalog = { channels: {} }, overrides = { matches: {} }, routeState = { matches: {} }, activeCatalog = { matches: {} }, assignments = { assignments: [], ignored: [] }, checked = 0;
  const hasEnabledSources = (name) => PROVIDER_IDS.some((id) => catalog.providers?.[id]?.enabled && catalog.channels?.[name]?.[id]);
  const assignmentFor = (matchId) => {
    const id = String(matchId || '').trim();
    if (!id) return null;
    const assigned = (assignments.assignments || []).find((item) => String(item?.matchId || '') === id);
    if (assigned?.providerId && assigned?.resolvedChannel) {
      return {
        matchId: id,
        status: 'ASSIGNED',
        providerId: String(assigned.providerId),
        requestedChannel: assigned.requestedChannel || null,
        resolvedChannel: String(assigned.resolvedChannel).trim(),
        priorityScore: Number(assigned.priorityScore || 0),
        source: 'match-resource-assignment',
      };
    }
    const ignored = (assignments.ignored || []).find((item) => String(item?.matchId || '') === id);
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
    try { catalog = JSON.parse(readFileSync(env.PROVIDER_CATALOG_PATH || '/etc/koratv/provider-catalog.json', 'utf8')); } catch {}
    try { overrides = JSON.parse(readFileSync(env.MANUAL_BROADCAST_OVERRIDE_PATH || '/etc/koratv/manual-broadcast-override.json', 'utf8')); } catch {}
    try { routeState = JSON.parse(readFileSync(env.DIRECT_MATCH_ROUTE_STATE_PATH || '/etc/koratv/direct-match-route-state.json', 'utf8')); } catch {}
    try { activeCatalog = JSON.parse(readFileSync(env.ACTIVE_CATALOG_PATH || '/etc/koratv/active-catalog.json', 'utf8')); } catch {}
    try { assignments = JSON.parse(readFileSync(env.MATCH_RESOURCE_ASSIGNMENT_PATH || '/etc/koratv/match-resource-assignments.json', 'utf8')); } catch {}
  };
  const resolve = (channel) => {
    refresh();
    const requested = String(channel || '').trim();
    if (!requested) return null;
    if (catalog.channels?.[requested] && hasEnabledSources(requested)) return requested;
    const matchRows = (rows) => {
      const matched = findChannelNameMatch(requested, rows.map((row) => row.alias));
      if (!matched) return null;
      const matches = rows.filter((row) => row.alias === matched);
      const names = [...new Set(matches.map((row) => row.name).filter(hasEnabledSources))];
      return names.length === 1 ? names[0] : null;
    };
    const sourceAliases = [];
    const channelAliases = [];
    for (const [name, entry] of Object.entries(catalog.channels || {})) {
      if (!hasEnabledSources(name)) continue;
      channelAliases.push({ alias: name, name });
      for (const sourceName of Object.values(entry?.sourceNames || {})) {
        if (sourceName) sourceAliases.push({ alias: sourceName, name });
      }
    }
    return matchRows(sourceAliases) || matchRows(channelAliases);
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
        if (resolved && catalog.providers?.[id]?.enabled && catalog.channels?.[resolved]?.[id]) sources[id] = catalog.channels[resolved][id];
      }
      return sources;
    },
  };
}
