import { readFileSync } from 'node:fs';
import { findChannelNameMatch } from '../shared/channel-name-match.mjs';
import { PROVIDER_IDS } from './provider-pool.js';

export function selectProviderChannel(match) {
  const qualityRank = candidate => /\b(?:4k|uhd|fhd|1080p)\b/i.test(candidate.source_name) ? 1 : /\b(?:hd|720p)\b/i.test(candidate.source_name) ? 0 : 2;
  return [...(match.candidates || [])]
    .filter(candidate => findChannelNameMatch(match.name, [candidate.source_name]) === candidate.source_name)
    .sort((a, b) => qualityRank(a) - qualityRank(b) || a.source_name.localeCompare(b.source_name))[0] || null;
}

export function createProviderCatalog(env = process.env) {
  let catalog = { channels: {} }, overrides = { matches: {} }, routeState = { matches: {} }, activeCatalog = { matches: {} }, checked = 0;
  const refresh = (force = false) => {
    if (!force && Date.now() - checked < 5000) return;
    checked = Date.now();
    try { catalog = JSON.parse(readFileSync(env.PROVIDER_CATALOG_PATH || '/etc/koratv/provider-catalog.json', 'utf8')); } catch {}
    try { overrides = JSON.parse(readFileSync(env.MANUAL_BROADCAST_OVERRIDE_PATH || '/etc/koratv/manual-broadcast-override.json', 'utf8')); } catch {}
    try { routeState = JSON.parse(readFileSync(env.DIRECT_MATCH_ROUTE_STATE_PATH || '/etc/koratv/direct-match-route-state.json', 'utf8')); } catch {}
    try { activeCatalog = JSON.parse(readFileSync(env.ACTIVE_CATALOG_PATH || '/etc/koratv/active-catalog.json', 'utf8')); } catch {}
  };
  const resolve = (channel) => {
    refresh();
    const requested = String(channel || '').trim();
    if (!requested) return null;
    if (catalog.channels?.[requested]) return requested;
    const matchRows = (rows) => {
      const matched = findChannelNameMatch(requested, rows.map((row) => row.alias));
      if (!matched) return null;
      const matches = rows.filter((row) => row.alias === matched);
      const names = [...new Set(matches.map((row) => row.name))];
      return names.length === 1 ? names[0] : null;
    };
    const sourceAliases = [];
    const channelAliases = [];
    for (const [name, entry] of Object.entries(catalog.channels || {})) {
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
