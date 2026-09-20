import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClientIpResolver } from './client-ip.js';

const issuer = 'koratv-gateway';
const ttl = 300;
const bot = /bot|crawler|spider|slurp|headless/i;

function moroccoPart(value, options) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', ...options }).format(date);
}

function normalizeMatch(row) {
  const payload = row.payload || {};
  const scheduledAt = row.kickoff_time || payload.scheduledAt || '';
  return {
    ...payload,
    match_id: row.match_id || row.id,
    matchId: row.match_id || row.id,
    homeTeam: row.home_team || payload.homeTeam?.name || payload.homeTeam || '',
    awayTeam: row.away_team || payload.awayTeam?.name || payload.awayTeam || '',
    homeLogo: payload.homeLogo || payload.homeTeam?.logo || '',
    awayLogo: payload.awayLogo || payload.awayTeam?.logo || '',
    scheduledAt,
    time: payload.time || moroccoPart(scheduledAt, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }),
    score: payload.score || 'VS',
    league: row.league || payload.league || '',
    channel: row.channel || payload.channel || '',
    commentator: payload.commentator || '',
    streams: Array.isArray(payload.streams) ? payload.streams : [],
    isLive: Boolean(payload.isLive),
    updatedAt: row.updated_at
  };
}

export function createApp({ config, redis, fetchImpl = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustedProxies);
  app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    const allowed = ['/api/generate-token', '/api/config', '/api/matches'].includes(req.path) ? config.frontend : config.player;
    if (req.headers.origin === allowed) {
      res.set({ 'Access-Control-Allow-Origin': allowed, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Range' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(req.headers.origin === allowed ? 204 : 403);
    next();
  });
  const clientIp = createClientIpResolver(config.cloudflareProxies);
  const ipHash = (req) => createHmac('sha256', config.hmacSecret).update(clientIp(req)).digest('hex');
  const sign = (claims, audience) => jwt.sign(claims, config.secret, { algorithm: 'HS256', issuer, audience, expiresIn: ttl, jwtid: randomUUID() });
  const verify = (token, req, audience) => {
    const claims = jwt.verify(token, config.secret, { algorithms: ['HS256'], issuer, audience });
    if (claims.ip !== ipHash(req) || !config.streams[claims.channel]) throw new Error('Forbidden');
    return claims;
  };
  const enabled = async (matchId, channel) => (await config.getStreamingConfig(matchId, channel)).is_streaming_active === true;
  const requireOrigin = (req, expected) => {
    if (req.headers.origin !== expected) throw new Error('Forbidden');
  };
  const key = createHash('sha256').update(config.secret).update('resource-urls').digest();

  app.get('/healthz', async (req, res) => {
    try {
      await redis.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const seal = (url, session) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(session));
    const data = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  };
  const unseal = (value, session) => {
    const data = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(session));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  };
  const allowedUrl = (value) => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !config.upstreamOrigins.has(url.origin)) throw new Error('Unapproved upstream');
    return url;
  };
  app.get('/api/config', async (req, res) => {
    try { res.json({ is_streaming_active: await enabled(req.query.matchId) }); }
    catch { res.status(503).json({ is_streaming_active: false }); }
  });
  app.get('/api/matches', async (req, res) => {
    try {
      const seen = new Set();
      const matches = (await config.getMatches())
        .map(normalizeMatch)
        .filter((match) => match.homeTeam && match.awayTeam && match.scheduledAt)
        .filter((match) => String(match.homeTeam).trim() !== String(match.awayTeam).trim())
        .filter((match) => {
          const key = `${String(match.homeTeam).trim().normalize('NFKC').toLocaleLowerCase('ar')}|${String(match.awayTeam).trim().normalize('NFKC').toLocaleLowerCase('ar')}|${String(match.scheduledAt).slice(0, 10)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const day = req.query.day;
      const today = moroccoPart(Date.now(), { year: 'numeric', month: '2-digit', day: '2-digit' });
      const tomorrow = moroccoPart(Date.now() + 86400000, { year: 'numeric', month: '2-digit', day: '2-digit' });
      const filtered = day === 'today'
        ? matches.filter((match) => moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === today)
        : day === 'tomorrow'
          ? matches.filter((match) => moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === tomorrow)
          : matches;
      res.json({ matches: filtered });
    } catch {
      res.status(503).json({ error: 'Match service is unavailable' });
    }
  });
  app.post('/api/generate-token', async (req, res) => {
    try {
      requireOrigin(req, config.frontend);
      if (!await enabled(req.body.matchId, req.body.channel) || bot.test(req.headers['user-agent'] || '') || !Object.hasOwn(config.streams, req.body.channel)) return res.sendStatus(403);
      const rateKey = `stream-rate:${ipHash(req)}:${Math.floor(Date.now() / 60000)}`;
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.expire(rateKey, 60);
      if (count > 20) return res.sendStatus(429);
      const token = sign({ ip: ipHash(req), channel: req.body.channel, matchId: req.body.matchId }, 'player-entry');
      res.json({ token, expiresIn: ttl });
    } catch { res.sendStatus(403); }
  });
  // Entry tickets are consumed atomically across workers; HLS sessions support repeated segment requests.
  app.post('/api/redeem-token', async (req, res) => {
    try {
      requireOrigin(req, config.player);
      const claims = verify(req.body.token, req, 'player-entry');
      if (!await enabled(claims.matchId, claims.channel)) return res.sendStatus(403);
      const result = await redis.set(`stream-used:${claims.jti}`, '1', { NX: true, EX: ttl });
      if (result !== 'OK') return res.sendStatus(403);
      res.json({ token: sign({ ip: claims.ip, channel: claims.channel, matchId: claims.matchId }, 'hls-session'), expiresIn: ttl });
    } catch { res.sendStatus(403); }
  });
  app.get(['/api/stream.m3u8', '/api/resource'], async (req, res) => {
    let claims;
    try {
      requireOrigin(req, config.player);
      claims = verify(req.query.token, req, 'hls-session');
      if (!await enabled(claims.matchId, claims.channel)) return res.sendStatus(403);
    } catch { return res.sendStatus(403); }
    try {
      const source = allowedUrl(req.path === '/api/stream.m3u8' ? config.streams[claims.channel] : unseal(req.query.resource, claims.jti));
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await fetchImpl(source, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!upstream.ok) { await upstream.body?.cancel(); return res.sendStatus(502); }
      const type = upstream.headers.get('content-type') || '';
      if (/mpegurl/i.test(type) || source.pathname.endsWith('.m3u8')) {
        const text = await upstream.text();
        if (!text.trimStart().startsWith('#EXTM3U')) return res.sendStatus(502);
        const rewrite = (uri) => {
          const target = allowedUrl(new URL(uri, source).href);
          return `${config.api}/api/resource?token=${encodeURIComponent(req.query.token)}&resource=${seal(target.href, claims.jti)}`;
        };
        const manifest = text.split(/\r?\n/).map((line) => {
          if (!line.trim()) return line;
          if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewrite(uri)}"`);
          return rewrite(line.trim());
        }).join('\n');
        return res.type('application/vnd.apple.mpegurl').send(manifest);
      }
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upstream.headers.has(name)) res.set(name, upstream.headers.get(name));
      }
      res.status(upstream.status);
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      if (!res.headersSent) res.sendStatus(502);
      else res.destroy();
    }
  });
  app.use((error, req, res, next) => { if (!res.headersSent) res.sendStatus(400); else next(error); });
  return app;
}
