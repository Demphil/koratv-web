export const STORAGE_KEY = 'koratv-safe-ads-v1';

export function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function adDecision(config, stored, now = Date.now()) {
  const providers = (config.click?.providers || []).filter((p) => p.enabled === true && httpsUrl(p.url));
  const cooldown = Math.max(0, Number(config.click_cooldown_minutes) || 0) * 60000;
  const windowMs = Math.max(1, Number(config.session_window_minutes) || 360) * 60000;
  const max = Math.max(0, Math.floor(Number(config.max_ads_per_session) || 0));
  const valid = stored && Number.isFinite(stored.startedAt) && Number.isFinite(stored.lastAt)
    && Number.isInteger(stored.count) && stored.count >= 0;
  const state = valid && now >= stored.startedAt && now - stored.startedAt < windowMs
    ? { ...stored } : { startedAt: now, lastAt: valid ? stored.lastAt : 0, count: 0 };
  const eligible = config.enabled === true && config.click?.enabled === true && providers.length > 0
    && state.count < max && (!state.lastAt || now - state.lastAt >= cooldown);
  return { eligible, state, url: eligible ? httpsUrl(providers[state.count % providers.length].url) : null };
}

export function consumeAd(storage, config, now = Date.now()) {
  // Persist before opening a tab. Storage failure disables the ad, never playback.
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    const decision = adDecision(config, stored, now);
    if (!decision.eligible) return null;
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...decision.state, count: decision.state.count + 1, lastAt: now }));
    return decision.url;
  } catch { return null; }
}
