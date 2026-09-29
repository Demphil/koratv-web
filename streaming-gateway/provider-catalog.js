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
  let catalog = { channels: {} }, overrides = { matches: {} }, checked = 0;
  const refresh = (force = false) => {
    if (!force && Date.now() - checked < 5000) return;
    checked = Date.now();
    try { catalog = JSON.parse(readFileSync(env.PROVIDER_CATALOG_PATH || '/etc/koratv/provider-catalog.json', 'utf8')); } catch {}
    try { overrides = JSON.parse(readFileSync(env.MANUAL_BROADCAST_OVERRIDE_PATH || '/etc/koratv/manual-broadcast-override.json', 'utf8')); } catch {}
  };
  return {
    refreshNow() { checked = 0; refresh(true); },
    accounts() { refresh(); return catalog.providers || {}; },
    channels() { refresh(); return catalog.channels || {}; },
    override(matchId) {
      refresh(); const item = overrides.matches?.[matchId];
      if (!item || item.enabled === false || !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now()) return null;
      return typeof item.channel === 'string' ? item.channel : null;
    },
    sources(channel) {
      refresh(); const sources = {};
      for (const id of PROVIDER_IDS) {
        if (catalog.providers?.[id]?.enabled && catalog.channels?.[channel]?.[id]) sources[id] = catalog.channels[channel][id];
      }
      return sources;
    },
  };
}
