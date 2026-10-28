import { PROVIDER_IDS } from './provider-pool.js';

export function createOperatorChannelPreparer({ pool, accounts, resolveChannel, discover, warm, install, refresh }) {
  return async (channel, phase, match, { providerId = '', takeover = false } = {}) => {
    if (!pool || !discover) throw new Error('channel_not_found');
    pool.rebalance();
    const inventory = accounts();
    const targetViewer = `prewarm:${match?.matchId}`;
    const ownsTarget = lease => {
      const viewers = pool.demands.get(lease.key)?.viewers;
      return viewers?.has(targetViewer) && ![...viewers.keys()].some(viewer => viewer.startsWith('prewarm:') && viewer !== targetViewer);
    };
    const target = [...pool.leases.values()].find(ownsTarget);
    if (providerId && (!PROVIDER_IDS.includes(providerId) || !inventory[providerId]?.enabled)) throw new Error('invalid_provider');
    if (providerId && pool.leases.has(providerId) && !ownsTarget(pool.leases.get(providerId)) && !takeover) throw new Error('provider_busy');
    if (providerId && pool.probes.has(providerId)) throw new Error('provider_unavailable');
    const available = PROVIDER_IDS.filter(id => inventory[id]?.enabled && !pool.leases.has(id)
      && !pool.probes.has(id) && (pool.blocked.get(id) || 0) <= pool.now());
    if (target && inventory[target.provider]?.enabled && !available.includes(target.provider)) available.push(target.provider);
    const candidates = providerId ? [providerId] : available;
    if (!candidates.length) throw new Error('no_free_provider');
    phase('discovering');
    let probes = 0;
    const deadline = Date.now() + 45000;
    const canonical = resolveChannel?.(channel) || channel;
    const explicitVariant = canonical !== channel && /\b(?:4k|uhd|fhd|sd)\b/i.test(channel) ? channel : null;
    const result = await discover(canonical, candidates, async (provider, chosen, name) => {
      if (explicitVariant && chosen.source_name?.trim().toLowerCase() !== explicitVariant.toLowerCase()) return false;
      if (++probes > 8 || Date.now() >= deadline) return false;
      phase('testing_media');
      const current = pool.leases.get(provider);
      if (current && !(takeover && provider === providerId) && !(current.provider === target?.provider && ownsTarget(current)) && !(current.channel === name && current.url === chosen.original_url)) return false;
      try {
        const test = lease => warm({ channel_id: name, match_id: match?.matchId, match }, lease);
        const probe = current?.channel === name && current.url === chosen.original_url
          ? await test(current)
          : await pool.probe(provider, name, chosen.original_url, test);
        return probe.ok === true;
      } catch { return false; }
    }, explicitVariant);
    if (!result?.resolvedChannel || !Object.keys(result.provider_sources || {}).length) throw new Error(probes ? 'channel_probe_failed' : 'channel_not_found');
    await install(result);
    refresh();
    const verifiedProvider = Object.keys(result.provider_sources)[0];
    pool.blocked.delete(verifiedProvider);
    for (const demand of pool.demands.values()) if (demand.viewers.has(targetViewer) && demand.failedProvider === verifiedProvider) demand.failedUntil = 0;
    return { name: result.resolvedChannel, providerId: verifiedProvider };
  };
}
