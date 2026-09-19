import { createStreamingConfigReader } from './supabase.js';

export function loadConfig(env = process.env) {
  const secret = env.JWT_SECRET || '';
  const hmacSecret = env.HMAC_SECRET || '';
  if (secret.length < 32 || secret.startsWith('replace-')) throw new Error('Configure a random JWT_SECRET of at least 32 bytes');
  if (hmacSecret.length < 32 || hmacSecret.startsWith('replace-') || hmacSecret === secret) throw new Error('Configure a separate random HMAC_SECRET of at least 32 bytes');
  const origin = (value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Public origins require HTTPS');
    return url.origin;
  };
  return {
    secret,
    hmacSecret,
    frontend: origin(env.FRONTEND_ORIGIN || 'https://koratv.click'),
    player: origin(env.PLAYER_ORIGIN || 'https://medic.cymru'),
    api: origin(env.PUBLIC_API_ORIGIN),
    trustedProxies: (env.TRUSTED_PROXIES || '').split(',').filter(Boolean),
    cloudflareProxies: (env.CLOUDFLARE_HEADER_TRUSTED_PROXIES || '').split(',').filter(Boolean),
    streams: JSON.parse(env.STREAMS_JSON || '{}'),
    upstreamOrigins: new Set((env.UPSTREAM_ORIGINS || '').split(',').filter(Boolean).map(origin)),
    getStreamingConfig: createStreamingConfigReader(env),
  };
}
