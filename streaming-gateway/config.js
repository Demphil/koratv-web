import { createMatchesReader, createPlaybackResolver } from './supabase.js';
import { attachApiFootballDetails } from '../shared/match-details.mjs';
import { sameFixture } from '../shared/match-broadcasts.mjs';
import { isAllowedMatch, isGulfCupLeague } from '../shared/league-whitelist.mjs';
import { createProviderCatalog } from './provider-catalog.js';
import { createProviderLiveResolver } from './provider-live-resolver.js';

function sourceForOrigin(origin, { koratvOrigins, frajaOrigins }) {
  if (koratvOrigins.has(origin)) return 'kooora';
  if (frajaOrigins.has(origin)) return 'kooora';
  return '';
}

export function sourceForMatchId(matchId) {
  const id = String(matchId || '');
  if (id.startsWith('kooora_')) return 'kooora';
  if (id.startsWith('api-football_')) return 'api-football';
  return '';
}

export function loadConfig(env = process.env) {
  const secret = env.JWT_SECRET || '';
  const hmacSecret = env.HMAC_SECRET || '';
  if (secret.length < 32 || secret.startsWith('replace-')) throw new Error('Configure a random JWT_SECRET of at least 32 bytes');
  if (hmacSecret.length < 32 || hmacSecret.startsWith('replace-') || hmacSecret === secret) throw new Error('Configure a separate random HMAC_SECRET of at least 32 bytes');
  const publicOrigin = (name, value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be an absolute HTTPS origin`);
    }
    if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
    return url.origin;
  };
  const publicOrigins = (name, value) => new Set(String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => publicOrigin(name, item)));
  const koratvOrigins = publicOrigins('KORATV_FRONTEND_ORIGINS', env.KORATV_FRONTEND_ORIGINS || 'https://koratv.click,https://www.koratv.click');
  const frajaOrigins = publicOrigins('FRAJA_FRONTEND_ORIGINS', env.FRAJA_FRONTEND_ORIGINS || 'https://fraja.online,https://www.fraja.online,https://frajatv.online,https://www.frajatv.online,https://frajatv.fun,https://www.frajatv.fun');
  const upstreamOrigin = (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('UPSTREAM_ORIGINS contains an invalid origin');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('UPSTREAM_ORIGINS only accepts HTTP(S) origins without credentials');
    }
    return url.origin;
  };
  const koooraSources = ['kooora'];
  const apiFootballSources = ['api-football'];
  const providerPoolEnabled = env.PROVIDER_POOL_ENABLED === 'true';
  const catalog = providerPoolEnabled ? createProviderCatalog(env) : null;
  const liveResolver = catalog && env.PROVIDER_LIVE_RESOLVER_ENABLED !== 'false'
    ? createProviderLiveResolver({ env, accounts: () => catalog.accounts() })
    : null;
  const getKoooraMatches = createMatchesReader(env, koooraSources, catalog);
  const getApiFootballMatches = createMatchesReader(env, apiFootballSources, catalog);
  const cachedResolver = resolver => {
    const cache = new Map();
    return (matchId, { fresh = false } = {}) => {
      if (fresh) cache.delete(matchId);
      const entry = cache.get(matchId);
      if (entry && entry.until > Date.now()) return entry.promise;
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      const promise = resolver(matchId).catch(error => { cache.delete(matchId); throw error; });
      cache.set(matchId, { promise, until: Date.now() + 3000 });
      return promise;
    };
  };
  const getKoooraPlayback = cachedResolver(createPlaybackResolver(env, koooraSources, catalog, liveResolver));
  const getApiFootballPlayback = cachedResolver(createPlaybackResolver(env, apiFootballSources, catalog, liveResolver));

  return {
    secret,
    providerPoolEnabled,
    directProviderResolutionEnabled: Boolean(liveResolver),
    providerAccounts: catalog ? () => catalog.accounts() : null,
    providerChannels: catalog ? () => catalog.channels() : null,
    refreshProviderCatalog: catalog ? () => catalog.refreshNow() : null,
    accountsStatusPath: env.ACCOUNTS_STATUS_PATH || '/etc/koratv/accounts-status.json',
    hmacSecret,
    enableAntiBot: String(env.ENABLE_ANTI_BOT || 'true').trim().toLowerCase() !== 'false',
    frontend: publicOrigin('FRONTEND_ORIGIN', env.FRONTEND_ORIGIN || 'https://koratv.click'),
    frontendOrigins: publicOrigins('FRONTEND_ORIGINS', env.FRONTEND_ORIGINS || env.FRONTEND_ORIGIN || 'https://fraja.online,https://www.fraja.online,https://frajatv.online,https://www.frajatv.online,https://frajatv.fun,https://www.frajatv.fun,https://koratv.click,https://www.koratv.click'),
    koratvOrigins,
    frajaOrigins,
    player: publicOrigin('PLAYER_ORIGIN', env.PLAYER_ORIGIN || 'https://fabor.sbs'),
    api: publicOrigin('PUBLIC_API_ORIGIN', env.PUBLIC_API_ORIGIN),
    relaxEntryIpBinding: env.RELAX_ENTRY_IP_BINDING === 'true',
    relaxHlsIpBinding: env.RELAX_HLS_IP_BINDING === 'true',
    trustedProxies: (env.TRUSTED_PROXIES || '').split(',').filter(Boolean),
    cloudflareProxies: (env.CLOUDFLARE_HEADER_TRUSTED_PROXIES || '').split(',').filter(Boolean),
    sessionTtl: Math.max(300, Number(env.STREAM_SESSION_TTL_SECONDS || 10800)),
    streamOpensBeforeMinutes: Number(env.STREAM_OPENS_BEFORE_MINUTES || 20),
    streamClosesAfterMinutes: Number(env.STREAM_CLOSES_AFTER_MINUTES || 150),
    upstreamUserAgent: env.IPTV_UPSTREAM_USER_AGENT || 'IPTVSmartersPlayer',
    upstreamOrigins: new Set((env.UPSTREAM_ORIGINS || '').split(',').filter(Boolean).map(upstreamOrigin)),
    sourceForOrigin: (origin) => sourceForOrigin(origin, { koratvOrigins, frajaOrigins }),
    getMatches: getApiFootballMatches,
    getMatchesForOrigin: async (origin, matchId = '') => {
      const source = sourceForMatchId(matchId) || sourceForOrigin(origin, { koratvOrigins, frajaOrigins });
      if (source === 'kooora') {
        const rows = await getKoooraMatches();
        if (!matchId) {
          const apiRows = await getApiFootballMatches();
          const gulfFixtures = apiRows.filter(row => isGulfCupLeague(row.league)
            && isAllowedMatch({
              league: row.league,
              leagueCountry: row.payload?.leagueCountry,
              homeTeam: row.home_team,
              awayTeam: row.away_team
            })
            && !rows.some(koooraRow => sameFixture(koooraRow, row)));
          return [...rows, ...gulfFixtures];
        }
        const row = rows.find(item => item.match_id === matchId || item.id === matchId);
        return row ? [attachApiFootballDetails(row, await getApiFootballMatches())] : [];
      }
      if (source === 'api-football') return getApiFootballMatches();
      return [...await getApiFootballMatches(), ...await getKoooraMatches()];
    },
    getPlayback: getApiFootballPlayback,
    getPlaybackForSource: async (source, matchId, options = {}) => {
      const matchSource = sourceForMatchId(matchId);
      if (matchSource === 'kooora' || (!matchSource && source === 'kooora')) return getKoooraPlayback(matchId, options);
      if (matchSource === 'api-football' || (!matchSource && source === 'api-football')) return getApiFootballPlayback(matchId, options);
      const apiPlayback = await getApiFootballPlayback(matchId, options);
      return apiPlayback?.is_streaming_active ? apiPlayback : getKoooraPlayback(matchId, options);
    }
  };
}
