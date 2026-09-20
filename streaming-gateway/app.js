import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClientIpResolver } from './client-ip.js';
import { isAllowedLeague } from '../shared/league-whitelist.mjs';

const issuer = 'koratv-gateway';
const entryTtl = 300;
const bot = /bot|crawler|spider|slurp|headless/i;

function moroccoPart(value, options) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', ...options }).format(date);
}

function matchPlaybackState(row, config) {
  const payload = row.payload || {};
  const scheduledAt = row.kickoff_time || payload.scheduledAt || '';
  const kickoff = new Date(scheduledAt);
  const status = String(payload.status || payload.state || payload.matchStatus || '').toLowerCase();
  if (/result|finished|ended|full.?time|انته/.test(status)) return 'ended';
  if (Number.isNaN(kickoff.getTime())) return 'upcoming';

  const opensBeforeMs = Number(process.env.STREAM_OPENS_BEFORE_MINUTES || config.streamOpensBeforeMinutes || 20) * 60_000;
  const closesAfterMs = Number(process.env.STREAM_CLOSES_AFTER_MINUTES || config.streamClosesAfterMinutes || 150) * 60_000;
  const now = Date.now();
  if (now > kickoff.getTime() + closesAfterMs) return 'ended';
  if (now >= kickoff.getTime() - opensBeforeMs) return 'live';
  return 'upcoming';
}

function clampLiveMinute(row) {
  const payload = row.payload || {};
  const explicit = Number(payload.minute ?? payload.liveMinute ?? payload.matchMinute);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(130, Math.max(0, Math.round(explicit)));

  const scheduledAt = row.kickoff_time || payload.scheduledAt || '';
  const kickoff = new Date(scheduledAt);
  if (Number.isNaN(kickoff.getTime())) return null;
  return Math.min(130, Math.max(0, Math.floor((Date.now() - kickoff.getTime()) / 60_000)));
}

function normalizeCardCount(value) {
  if (!value || typeof value !== 'object') return null;
  const home = Number(value.home ?? value.homeTeam ?? value.local ?? 0);
  const away = Number(value.away ?? value.awayTeam ?? value.visitor ?? 0);
  return {
    home: Number.isFinite(home) ? home : 0,
    away: Number.isFinite(away) ? away : 0
  };
}

function normalizeMatch(row, config) {
  const payload = row.payload || {};
  const scheduledAt = row.kickoff_time || payload.scheduledAt || '';
  const playbackState = matchPlaybackState(row, config);
  const cards = payload.cards || payload.stats?.cards || {};
  return {
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
    channel: '',
    commentator: payload.commentator || '',
    status: payload.status || payload.state || payload.matchStatus || '',
    streams: [],
    sourceReady: row.source_ready === true && playbackState === 'live',
    sourceAvailable: row.source_ready === true,
    playbackState,
    isLive: playbackState === 'live',
    liveMinute: playbackState === 'live' ? clampLiveMinute(row) : null,
    yellowCards: normalizeCardCount(payload.yellowCards || cards.yellow || payload.stats?.yellowCards),
    redCards: normalizeCardCount(payload.redCards || cards.red || payload.stats?.redCards),
    updatedAt: row.updated_at
  };
}

export function createApp({ config, redis, fetchImpl = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustedProxies);
  app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    });
    const allowed = ['/api/generate-token', '/api/config', '/api/matches'].includes(req.path) ? config.frontend : config.player;
    if (req.headers.origin === allowed) {
      res.set({ 'Access-Control-Allow-Origin': allowed, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Range' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(req.headers.origin === allowed ? 204 : 403);
    next();
  });
  const clientIp = createClientIpResolver(config.cloudflareProxies);
  const ipHash = (req) => createHmac('sha256', config.hmacSecret).update(clientIp(req)).digest('hex');
  const sign = (claims, audience, expiresIn = entryTtl) => jwt.sign(claims, config.secret, { algorithm: 'HS256', issuer, audience, expiresIn, jwtid: randomUUID() });
  const verify = (token, req, audience) => {
    const claims = jwt.verify(token, config.secret, { algorithms: ['HS256'], issuer, audience });
    if (claims.ip !== ipHash(req) || !claims.channel || !claims.matchId) throw new Error('Forbidden');
    return claims;
  };
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
  const allowedUrl = (value, runtimeOrigins = new Set()) => {
    const url = new URL(value);
    const blockedHost = /^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?)$/i;
    const approved = config.upstreamOrigins.has(url.origin) || runtimeOrigins.has(url.origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || blockedHost.test(url.hostname) || !approved) throw new Error('Unapproved upstream');
    return url;
  };
  app.get('/api/config', async (req, res) => {
    try {
      const playback = await config.getPlayback(String(req.query.matchId || ''));
      res.json({ is_streaming_active: playback.is_streaming_active, reason: playback.reason || null });
    }
    catch { res.status(503).json({ is_streaming_active: false }); }
  });
  app.get('/api/matches', async (req, res) => {
    try {
      const seen = new Set();
      const matches = (await config.getMatches())
        .map((row) => normalizeMatch(row, config))
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
      res.json({ matches: filtered.filter((match) => isAllowedLeague(match.league)) });
    } catch {
      res.status(503).json({ error: 'Match service is unavailable' });
    }
  });
  app.post('/api/generate-token', async (req, res) => {
    try {
      requireOrigin(req, config.frontend);
      if (bot.test(req.headers['user-agent'] || '')) return res.sendStatus(403);
      const playback = await config.getPlayback(String(req.body.matchId || ''));
      if (!playback.is_streaming_active) return res.status(409).json({ error: playback.reason || 'stream_unavailable' });
      const rateKey = `stream-rate:${ipHash(req)}:${Math.floor(Date.now() / 60000)}`;
      const count = await redis.incr(rateKey);
      if (count === 1) await redis.expire(rateKey, 60);
      if (count > 20) return res.sendStatus(429);
      const token = sign({ ip: ipHash(req), channel: playback.channel_id, matchId: playback.match_id }, 'player-entry');
      res.json({ token, expiresIn: entryTtl });
    } catch { res.sendStatus(403); }
  });
  // Entry tickets are consumed atomically across workers; HLS sessions support repeated segment requests.
  app.post('/api/redeem-token', async (req, res) => {
    try {
      requireOrigin(req, config.player);
      const claims = verify(req.body.token, req, 'player-entry');
      const playback = await config.getPlayback(claims.matchId);
      if (!playback.is_streaming_active || playback.channel_id !== claims.channel) return res.sendStatus(403);
      const result = await redis.set(`stream-used:${claims.jti}`, '1', { NX: true, EX: entryTtl });
      if (result !== 'OK') return res.sendStatus(403);
      const sourceId = randomUUID();
      await redis.set(`stream-source:${sourceId}`, playback.stream_url, { EX: config.sessionTtl });
      res.json({
        token: sign({ ip: claims.ip, channel: claims.channel, matchId: claims.matchId, sourceId }, 'hls-session', config.sessionTtl),
        expiresIn: config.sessionTtl
      });
    } catch { res.sendStatus(403); }
  });
  app.get(['/api/stream.m3u8', '/api/resource'], async (req, res) => {
    let claims;
    try {
      requireOrigin(req, config.player);
      claims = verify(req.query.token, req, 'hls-session');
      if (!claims.sourceId) return res.sendStatus(403);
    } catch { return res.sendStatus(403); }
    try {
      if (req.path === '/api/stream.m3u8') {
        const playback = await config.getPlayback(claims.matchId);
        if (!playback.is_streaming_active || playback.channel_id !== claims.channel) return res.sendStatus(403);
      }
      const rootSource = await redis.get(`stream-source:${claims.sourceId}`);
      if (!rootSource) return res.sendStatus(403);
      const rootUrl = new URL(rootSource);
      const runtimeOrigins = new Set([rootUrl.origin]);
      const source = allowedUrl(req.path === '/api/stream.m3u8' ? rootSource : unseal(req.query.resource, claims.jti), runtimeOrigins);
      const headers = {
        'User-Agent': config.upstreamUserAgent,
        Accept: '*/*'
      };
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await fetchImpl(source, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!upstream.ok) {
        console.error('[stream-proxy] upstream rejected request', {
          status: upstream.status,
          source: `${source.origin}${source.pathname}`,
          type: upstream.headers.get('content-type') || ''
        });
        await upstream.body?.cancel();
        return res.sendStatus(502);
      }
      const type = upstream.headers.get('content-type') || '';
      if (/mpegurl/i.test(type) || source.pathname.endsWith('.m3u8')) {
        const text = await upstream.text();
        if (!text.trimStart().startsWith('#EXTM3U')) {
          console.error('[stream-proxy] upstream response is not an HLS manifest', {
            source: `${source.origin}${source.pathname}`,
            type
          });
          return res.sendStatus(502);
        }
        const rewrite = (uri) => {
          const target = allowedUrl(new URL(uri, source).href, runtimeOrigins);
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
    } catch (error) {
      console.error('[stream-proxy] failed to proxy stream', {
        path: req.path,
        message: error?.message || String(error)
      });
      if (!res.headersSent) res.sendStatus(502);
      else res.destroy();
    }
  });
  app.use((error, req, res, next) => { if (!res.headersSent) res.sendStatus(400); else next(error); });
  return app;
}
