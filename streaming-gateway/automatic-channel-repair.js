export function createAutomaticChannelRepair({ pool, discover, warm, install, refresh, now = Date.now }) {
  const failedUntil = new Map();
  const pending = new Map();
  return async (playback, failedLease, { shouldContinue = () => true } = {}) => {
    if (!discover || !failedLease || !shouldContinue()) return null;
    const provider = failedLease.provider, channel = playback.channel_id;
    const key = `${provider}:${channel}`;
    if (pending.has(key)) return pending.get(key);
    if ((failedUntil.get(key) || 0) > now()) return null;
    const task = (async () => {
      let probes = 0;
      const verifiedUrls = new Set();
      const deadline = now() + 45_000;
      try {
        const result = await discover(channel, [provider], async (id, candidate, name) => {
          if (!shouldContinue() || id !== provider || name !== channel || candidate.original_url === failedLease.url
            || ++probes > 8 || now() >= deadline) return false;
          const current = pool.leases.get(provider);
          // Only replace this broken channel, never borrow another match's account.
          if (pool.probes.has(provider) || current && (current.key !== failedLease.key || current.channel !== channel)) return false;
          try {
            const ok = (await pool.probe(provider, channel, candidate.original_url,
              lease => warm(playback, lease))).ok === true;
            if (ok) verifiedUrls.add(candidate.original_url);
            return ok;
          } catch { return false; }
        });
        if (!shouldContinue()) return null;
        if (result?.resolvedChannel !== channel || !verifiedUrls.has(result.provider_sources?.[provider])
          || Object.keys(result.provider_sources).some(id => id !== provider)) throw new Error('no_verified_edition');
        await install(result);
        await refresh();
        failedUntil.delete(key);
        pool.blocked.delete(provider);
        const demand = pool.demands.get(failedLease.key);
        if (demand?.failedProvider === provider) demand.failedUntil = 0;
        return result;
      } catch {
        if (!shouldContinue()) return null;
        if (failedUntil.size >= 100) failedUntil.delete(failedUntil.keys().next().value);
        failedUntil.set(key, now() + 300_000);
        return null;
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
