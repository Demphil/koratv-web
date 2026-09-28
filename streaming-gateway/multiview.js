import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PROVIDER_IDS } from './provider-pool.js';

export const MULTIVIEW_CHANNELS = Array.from({ length: 6 }, (_, i) => `beIN SPORTS HD ${i + 1}`);

export function diagnosticPlayback(config, channel) {
  if (!MULTIVIEW_CHANNELS.includes(channel)) throw new Error('Invalid diagnostic channel');
  const accounts = config.providerAccounts?.() || {};
  const sources = config.providerChannels?.()[channel] || {};
  const provider_sources = Object.fromEntries(PROVIDER_IDS.filter(id => accounts[id]?.enabled && sources[id]).map(id => [id, sources[id]]));
  return { match_id: `diagnostic:${channel}`, pool_key: `diagnostic:${channel}`, channel_id: channel,
    is_streaming_active: Object.keys(provider_sources).length > 0, stream_url: Object.values(provider_sources)[0],
    provider_sources, priority_score: 10 };
}

export function registerMultiview(app, { config, redis, providerPool, accountHealth, hlsProgress, ipHash, sign }) {
  const authorize = (req, res, next) => {
    try {
      jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''), config.secret,
        { algorithms: ['HS256'], issuer: 'koratv-gateway', audience: 'multiview-admin' });
      if (!providerPool) return res.status(503).json({ error: 'pool_disabled' });
      next();
    } catch { res.status(401).json({ error: 'test_link_expired_or_missing' }); }
  };
  app.post('/api/multiview/session', authorize, async (req, res) => {
    const screens = [];
    for (const channel of MULTIVIEW_CHANNELS) {
      const playback = diagnosticPlayback(config, channel);
      if (!playback.is_streaming_active) { screens.push({ channel, error: 'channel_not_in_catalog' }); continue; }
      const sourceId = randomUUID();
      const ttl = 3600;
      await redis.set(`stream-source:${sourceId}`, playback.stream_url, { EX: ttl });
      const token = sign({ ip: ipHash(req), channel, matchId: playback.match_id, source: 'diagnostic', diagnostic: true, sourceId }, 'hls-session', ttl);
      screens.push({ channel, token, expiresIn: ttl, url: `${config.api}/api/stream.m3u8?token=${encodeURIComponent(token)}` });
    }
    res.json({ screens });
  });
  app.get('/api/multiview/status', authorize, (req, res) => {
    const accounts = accountHealth?.snapshot() || [];
    res.json({ checkedAt: new Date().toISOString(), screens: MULTIVIEW_CHANNELS.map(channel => {
      const lease = [...providerPool.leases.values()].find(item => providerPool.demands.get(item.key)?.channel === channel);
      const account = accounts.find(item => item.provider === lease?.provider);
      const progress = lease && hlsProgress.channels.get(`${lease.provider}:${channel}`);
      return { channel, provider: lease?.provider || null, account: account?.id || null,
        status: account?.status || 'IDLE', lastHttpCode: account?.last_http_code || null,
        sequence: progress?.sequence ?? null, lastManifestAt: progress?.lastSeen || null,
        stagnantForMs: progress ? Date.now() - progress.since : null };
    }) });
  });
}
