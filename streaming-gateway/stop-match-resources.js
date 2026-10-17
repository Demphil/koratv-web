export function releaseStoppedMatchResources(pool, matchIds, assignments, keepalive) {
  if (!pool) return;
  const stopped = new Set(matchIds);
  const otherChannels = new Set(assignments.filter(row => ![row.matchId, ...(row.aliases || [])].some(id => stopped.has(id))).map(row => row.resolvedChannel));
  for (const [key, demand] of pool.demands) {
    const viewers = [...demand.viewers.keys()].filter(id => id.startsWith('prewarm:') && stopped.has(id.slice(8)));
    if (!viewers.length) continue;
    for (const id of viewers) demand.viewers.delete(id);
    if (!otherChannels.has(demand.channel)) {
      pool.demands.delete(key);
      for (const lease of pool.leases.values()) if (lease.key === key) pool.revoke(lease.provider);
      keepalive.delete(key);
    } else {
      const survivor = [...demand.viewers.keys()].find(id => id.startsWith('prewarm:'));
      if (survivor) keepalive.set(key, survivor);
      else keepalive.delete(key);
    }
  }
  pool.rebalance();
}
