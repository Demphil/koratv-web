import { readFileSync } from 'node:fs';
import { credentialsFromCatalog, discoverProvider } from './provider-direct.js';
import { PROVIDER_IDS } from './provider-pool.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueNames(names) {
  return [...new Set((names || [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))];
}

export function createProviderLiveResolver({
  env = process.env,
  accounts,
  fetchImpl = fetch,
  cacheTtlMs = Number(process.env.PROVIDER_LIVE_RESOLVER_CACHE_MS || 60_000),
  staggerMs = Number(process.env.PROVIDER_LIVE_RESOLVER_STAGGER_MS || 250),
} = {}) {
  const cache = new Map();
  let credentialCache = { checkedAt: 0, credentials: {} };

  const loadPrivateCredentials = () => {
    if (Date.now() - credentialCache.checkedAt < 5000) return credentialCache.credentials;
    credentialCache.checkedAt = Date.now();
    const dir = env.PROVIDER_POOL_DIR || '/etc/koratv';
    let fileCredentials = {};
    try {
      fileCredentials = JSON.parse(readFileSync(`${dir}/provider-credentials.json`, 'utf8'));
    } catch {}
    const merged = {};
    for (const providerId of PROVIDER_IDS) {
      const input = env[`IPTV_PROVIDER_${providerId}_JSON`];
      if (input) {
        try { merged[providerId] = JSON.parse(input); } catch {}
      }
      if (!merged[providerId] && fileCredentials?.[providerId]) merged[providerId] = fileCredentials[providerId];
    }
    credentialCache.credentials = merged;
    return merged;
  };

  const resolve = async (requestedNames, options = {}) => {
    const names = uniqueNames(requestedNames);
    if (!names.length) return null;

    const cacheKey = names.map((name) => name.toLowerCase()).sort().join('|');
    const cached = cache.get(cacheKey);
    if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;

    const providerAccounts = typeof accounts === 'function' ? accounts() || {} : {};
    const privateCredentials = loadPrivateCredentials();
    const providerSources = {};
    const resolvedChannels = new Set();
    const attempts = [];

    const allowedProviders = Array.isArray(options.providerIds) && options.providerIds.length
      ? new Set(options.providerIds.map((id) => String(id)))
      : null;

    for (const providerId of PROVIDER_IDS) {
      if (allowedProviders && !allowedProviders.has(providerId)) continue;
      const account = providerAccounts[providerId];
      if (account && account.enabled === false) continue;
      const credentials = privateCredentials[providerId] || credentialsFromCatalog(account);
      if (!credentials) {
        attempts.push({ provider: providerId, status: 'missing_credentials' });
        continue;
      }
      const origins = [...new Set((credentials.origins?.length ? credentials.origins : account?.origins || []).filter(Boolean))];
      if (!origins.length) {
        attempts.push({ provider: providerId, status: 'missing_origins' });
        continue;
      }

      try {
        const result = await discoverProvider(credentials, origins, names, { fetchImpl, retry: 1 });
        const chosen = result.selected?.[0]?.chosen;
        if (chosen?.url) {
          providerSources[providerId] = chosen.url;
          resolvedChannels.add(result.selected[0].name || chosen.name);
        }
        attempts.push({
          provider: providerId,
          status: chosen?.url ? 'matched' : 'unmatched',
          matched: chosen?.name || null,
          upstreamAttempts: (result.attempts || []).map((attempt) => ({
            origin: attempt.origin,
            status: attempt.status || null,
            auth: attempt.auth,
            error: attempt.error || attempt.catalogError || null,
            sportsStreams: attempt.sportsStreams || 0,
            matchedChannels: attempt.matchedChannels || 0,
          })),
        });
      } catch (error) {
        attempts.push({ provider: providerId, status: 'error', error: error?.message || String(error) });
      }

      if (staggerMs > 0) await sleep(staggerMs);
    }

    const value = Object.keys(providerSources).length
      ? {
          requestedChannels: names,
          resolvedChannel: [...resolvedChannels][0] || names[0],
          provider_sources: providerSources,
          attempts,
          source: 'live-provider-resolver',
        }
      : { requestedChannels: names, resolvedChannel: null, provider_sources: {}, attempts, source: 'live-provider-resolver' };

    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { value, expiresAt: Date.now() + Math.max(1000, cacheTtlMs) });
    return value;
  };

  return {
    resolve,
    clear() { cache.clear(); },
  };
}
