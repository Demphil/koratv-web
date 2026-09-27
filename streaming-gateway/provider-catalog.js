import { readFileSync } from 'node:fs';

export function createProviderCatalog(env = process.env) {
  let catalog = { channels: {} }, overrides = { matches: {} }, checked = 0;
  const refresh = () => {
    if (Date.now() - checked < 5000) return;
    checked = Date.now();
    try { catalog = JSON.parse(readFileSync(env.PROVIDER_CATALOG_PATH || '/etc/koratv/provider-catalog.json', 'utf8')); } catch {}
    try { overrides = JSON.parse(readFileSync(env.MANUAL_BROADCAST_OVERRIDE_PATH || '/etc/koratv/manual-broadcast-override.json', 'utf8')); } catch {}
  };
  return {
    override(matchId) {
      refresh(); const item = overrides.matches?.[matchId];
      if (!item || item.enabled === false || !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now()) return null;
      return typeof item.channel === 'string' ? item.channel : null;
    },
    sources(channel, primaryUrl) {
      refresh(); const sources = primaryUrl ? { A: primaryUrl } : {};
      const account = catalog.providers?.B;
      if (account?.enabled && Date.parse(account.expiresAt) > Date.now() && catalog.channels?.[channel]?.B) sources.B = catalog.channels[channel].B;
      return sources;
    },
  };
}
