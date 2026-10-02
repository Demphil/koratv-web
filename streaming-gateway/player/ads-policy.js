export const STORAGE_KEY = 'koratv-safe-ads-v1';

export function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function clickProviders(config) {
  return (config.click?.providers || []).filter((p) => p.enabled === true && httpsUrl(p.url));
}

function clickWindow(config, stored, now = Date.now()) {
  const cooldown = Math.max(0, Number(config.click_cooldown_minutes) || 0) * 60000;
  const windowMs = Math.max(1, Number(config.session_window_minutes) || 360) * 60000;
  const max = Math.max(0, Math.floor(Number(config.max_ads_per_session) || 0));
  const valid = stored && Number.isFinite(stored.startedAt) && Number.isFinite(stored.lastAt)
    && Number.isInteger(stored.count) && stored.count >= 0;
  const state = valid && now >= stored.startedAt && now - stored.startedAt < windowMs
    ? { ...stored } : { startedAt: now, lastAt: valid ? stored.lastAt : 0, count: 0 };
  return { cooldown, windowMs, max, state };
}

export function nextAdDelayMs(config, stored, now = Date.now()) {
  const providers = clickProviders(config);
  const { cooldown, windowMs, max, state } = clickWindow(config, stored, now);
  if (config.enabled !== true || config.click?.enabled !== true || providers.length === 0 || max <= 0) return Infinity;
  if (state.lastAt && now < state.lastAt) return Math.max(1000, state.lastAt - now + cooldown);
  if (state.count >= max) return Math.max(1000, state.startedAt + windowMs - now);
  if (state.lastAt && now - state.lastAt < cooldown) return Math.max(1000, cooldown - (now - state.lastAt));
  return 0;
}

export function adDecision(config, stored, now = Date.now()) {
  const providers = clickProviders(config);
  const { cooldown, max, state } = clickWindow(config, stored, now);
  const eligible = config.enabled === true && config.click?.enabled === true && providers.length > 0
    && state.count < max && (!state.lastAt || now - state.lastAt >= cooldown);
  return { eligible, state, nextDelayMs: nextAdDelayMs(config, stored, now), url: eligible ? httpsUrl(providers[state.count % providers.length].url) : null };
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
