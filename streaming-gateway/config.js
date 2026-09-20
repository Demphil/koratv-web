import { createMatchesReader, createPlaybackResolver } from './supabase.js';

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
  return {
    secret,
    hmacSecret,
    frontend: publicOrigin('FRONTEND_ORIGIN', env.FRONTEND_ORIGIN || 'https://koratv.click'),
    player: publicOrigin('PLAYER_ORIGIN', env.PLAYER_ORIGIN || 'https://medic.cymru'),
    api: publicOrigin('PUBLIC_API_ORIGIN', env.PUBLIC_API_ORIGIN),
    trustedProxies: (env.TRUSTED_PROXIES || '').split(',').filter(Boolean),
    cloudflareProxies: (env.CLOUDFLARE_HEADER_TRUSTED_PROXIES || '').split(',').filter(Boolean),
    sessionTtl: Math.max(600, Number(env.STREAM_SESSION_TTL_SECONDS || 10800)),
    upstreamUserAgent: env.IPTV_UPSTREAM_USER_AGENT || 'KoraLiveProviderProbe/1.0',
    upstreamOrigins: new Set((env.UPSTREAM_ORIGINS || '').split(',').filter(Boolean).map(upstreamOrigin)),
    getMatches: createMatchesReader(env),
    getPlayback: createPlaybackResolver(env)
  };
}
