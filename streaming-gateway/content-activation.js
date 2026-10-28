export function assessContentActivation(health, now = Date.now()) {
  if (health?.status !== 'ok' || !Array.isArray(health.providerPool)) return { safe: false, reason: 'health_unavailable' };
  const prewarm = health.providerPrewarm;
  if (prewarm?.running) return { safe: false, reason: 'prewarm_running' };
  if (health.providerPool.length && (!prewarm || now - Date.parse(prewarm.lastRunAt) > 90_000)) return { safe: false, reason: 'stale_viewer_evidence' };
  let viewers = 0;
  for (const lease of health.providerPool) {
    if (!Number.isInteger(lease.viewers) || lease.viewers < 0) return { safe: false, reason: 'unknown_viewer_count' };
    const synthetic = new Set((prewarm.results || []).filter(row => row.ok && row.provider === lease.provider
      && row.channel === lease.channel && now - Date.parse(row.checkedAt) < 90_000).map(row => row.matchId)).size;
    viewers += Math.max(0, lease.viewers - synthetic);
  }
  return { safe: viewers === 0, reason: viewers ? 'viewers_present' : 'no_viewers', viewers };
}
