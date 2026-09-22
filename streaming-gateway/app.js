import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClientIpResolver } from './client-ip.js';
import { antiBotMiddleware } from './anti-bot.js';
import { isAllowedMatch, normalizeTeamName } from '../shared/league-whitelist.mjs';

const issuer = 'koratv-gateway';
const entryTtl = 300;

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
  if (typeof value === 'number') return { home: Number.isFinite(value) ? value : 0, away: 0 };
  if (!value || typeof value !== 'object') return null;
  const home = Number(value.home ?? value.homeTeam ?? value.local ?? value.teamA ?? value.first ?? value[0] ?? 0);
  const away = Number(value.away ?? value.awayTeam ?? value.visitor ?? value.teamB ?? value.second ?? value[1] ?? 0);
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
    goals: Array.isArray(payload.goals) ? payload.goals.slice(0, 12).map((goal) => ({
      player: String(goal.player || goal.name || '').slice(0, 80),
      minute: String(goal.minute || '').slice(0, 12),
      team: String(goal.team || '').slice(0, 16)
    })) : [],
    updatedAt: row.updated_at
  };
}

function normalizeMatchName(value) {
  return normalizeTeamName(String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim())
    .toLocaleLowerCase('ar');
}

function matchCompletenessScore(match) {
  let score = 0;
  if (match.sourceReady) score += 20;
  if (match.sourceAvailable) score += 10;
  if (match.playbackState === 'live') score += 12;
  if (match.playbackState === 'ended') score += 8;
  if (match.league && !/^league$/i.test(String(match.league).trim())) score += 8;
  if (match.homeLogo) score += 4;
  if (match.awayLogo) score += 4;
  if (match.score && match.score !== 'VS') score += 5;
  if (Number.isFinite(Number(match.liveMinute))) score += 3;
  if ((match.yellowCards?.home || match.yellowCards?.away || match.redCards?.home || match.redCards?.away)) score += 3;
  if (Array.isArray(match.goals) && match.goals.length) score += 2;
  return score;
}

function dedupeNormalizedMatches(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const teams = [normalizeMatchName(match.homeTeam), normalizeMatchName(match.awayTeam)].sort().join('|');
    const key = `${teams}|${String(match.scheduledAt || '').slice(0, 10)}`;
    const current = byKey.get(key);
    if (!current || matchCompletenessScore(match) > matchCompletenessScore(current)) byKey.set(key, match);
  }
  return [...byKey.values()];
}

function allowedMatch(match) {
  return isAllowedMatch({
    league: match.league,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam
  });
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
    const frontendOrigins = config.frontendOrigins || new Set([config.frontend]);
    const allowedOrigins = ['/api/generate-token', '/api/config', '/api/matches'].includes(req.path) ? frontendOrigins : new Set([config.player]);
    const requestOrigin = req.headers.origin;
    if (allowedOrigins.has(requestOrigin)) {
      res.set({ 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(allowedOrigins.has(requestOrigin) ? 204 : 403);
    next();
  });
  app.use(antiBotMiddleware({ enabled: config.enableAntiBot !== false }));
  const clientIp = createClientIpResolver(config.cloudflareProxies);
  const ipHash = (req) => createHmac('sha256', config.hmacSecret).update(clientIp(req)).digest('hex');
  const sign = (claims, audience, expiresIn = entryTtl) => jwt.sign(claims, config.secret, { algorithm: 'HS256', issuer, audience, expiresIn, jwtid: randomUUID() });
  const verify = (token, req, audience) => {
    const claims = jwt.verify(token, config.secret, { algorithms: ['HS256'], issuer, audience });
    if (claims.ip !== ipHash(req) || !claims.channel || !claims.matchId) throw new Error('Forbidden');
    return claims;
  };
  const requestToken = (req) => {
    const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
    return req.query.token || bearer || '';
  };
  const requireOrigin = (req, expected) => {
    const allowedOrigins = expected instanceof Set ? expected : new Set([expected]);
    if (!allowedOrigins.has(req.headers.origin)) throw new Error('Forbidden');
  };
  const key = createHash('sha256').update(config.secret).update('resource-urls').digest();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const upstreamDelay = (attempt) => Math.min(5000, 600 * (2 ** Math.max(0, attempt - 1)));
  const retryableStatus = (status) => status === 408 || status === 429 || status >= 500;
  const fetchUpstream = async (source, options, attempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const upstream = await fetchImpl(source, {
          ...options,
          signal: AbortSignal.timeout(attempt === 1 ? 10000 : 16000)
        });
        if (upstream.ok || !retryableStatus(upstream.status) || attempt === attempts) return upstream;
        await upstream.body?.cancel();
        console.warn('[stream-proxy] retrying upstream request', {
          attempt,
          status: upstream.status,
          source: `${source.origin}${source.pathname}`
        });
      } catch (error) {
        lastError = error;
        if (attempt === attempts) throw error;
        console.warn('[stream-proxy] upstream request failed, retrying', {
          attempt,
          message: error?.message || String(error),
          source: `${source.origin}${source.pathname}`
        });
      }
      await wait(upstreamDelay(attempt));
    }
    throw lastError || new Error('upstream_fetch_failed');
  };

  app.get('/healthz', async (req, res) => {
    try {
      await redis.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.get(/^\/[A-Za-z0-9]{10,24}$/, async (req, res) => {
    try {
      const html = await readFile(new URL('./dist/739184.html', import.meta.url), 'utf8');
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self' https: 'unsafe-inline'; style-src 'self'; img-src 'self' https: data:; media-src blob:; connect-src https:; worker-src blob:; frame-src https:; frame-ancestors https: http:; base-uri 'none'; form-action 'none'"
      });
      res.send(html);
    } catch {
      res.sendStatus(404);
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
  const publicQualities = (playback = {}) => {
    const seen = new Set();
    return (Array.isArray(playback.qualities) ? playback.qualities : [])
      .map((quality) => ({
        label: String(quality?.label || '').trim(),
        height: Number(quality?.height || 0)
      }))
      .filter((quality) => quality.label && !seen.has(quality.label) && seen.add(quality.label))
      .sort((a, b) => b.height - a.height);
  };
  const selectStreamUrl = (playback = {}, requestedQuality = '') => {
    const quality = String(requestedQuality || '').trim().toLowerCase();
    const sources = Array.isArray(playback.quality_sources) ? playback.quality_sources : [];
    const selected = sources.find((item) => String(item?.label || '').toLowerCase() === quality);
    return selected?.url || playback.stream_url;
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
      const matches = dedupeNormalizedMatches((await config.getMatches())
        .map((row) => normalizeMatch(row, config))
        .filter((match) => match.homeTeam && match.awayTeam && match.scheduledAt)
        .filter((match) => normalizeMatchName(match.homeTeam) !== normalizeMatchName(match.awayTeam)));
      const day = req.query.day;
      const today = moroccoPart(Date.now(), { year: 'numeric', month: '2-digit', day: '2-digit' });
      const tomorrow = moroccoPart(Date.now() + 86400000, { year: 'numeric', month: '2-digit', day: '2-digit' });
      const filtered = day === 'today'
        ? matches.filter((match) => moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === today)
        : day === 'tomorrow'
          ? matches.filter((match) => moroccoPart(match.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === tomorrow)
          : matches;
      res.json({ matches: filtered.filter(allowedMatch) });
    } catch {
      res.status(503).json({ error: 'Match service is unavailable' });
    }
  });
  app.get('/api/match-info', async (req, res) => {
    try {
      const matchId = String(req.query.matchId || '').trim();
      if (!matchId || matchId.length > 160) return res.sendStatus(400);
      const match = (await config.getMatches())
        .map((row) => normalizeMatch(row, config))
        .find((item) => (item.matchId === matchId || item.match_id === matchId) && allowedMatch(item));
      if (!match) return res.sendStatus(404);
      res.json({ match });
    } catch {
      res.status(503).json({ error: 'Match info is unavailable' });
    }
  });
  app.post('/api/generate-token', async (req, res) => {
    try {
      requireOrigin(req, config.frontendOrigins || config.frontend);
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
        expiresIn: config.sessionTtl,
        qualities: publicQualities(playback)
      });
    } catch { res.sendStatus(403); }
  });
  app.get(['/api/stream.m3u8', '/api/resource'], async (req, res) => {
    let claims;
    try {
      requireOrigin(req, config.player);
      const token = requestToken(req);
      claims = verify(token, req, 'hls-session');
      if (!claims.sourceId) return res.sendStatus(403);
    } catch { return res.sendStatus(403); }
    try {
      if (req.path === '/api/stream.m3u8') {
        const playback = await config.getPlayback(claims.matchId);
        if (!playback.is_streaming_active || playback.channel_id !== claims.channel) return res.sendStatus(403);
        await redis.set(`stream-source:${claims.sourceId}`, selectStreamUrl(playback, req.query.quality), { EX: config.sessionTtl });
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
      const upstream = await fetchUpstream(source, { headers, redirect: 'follow' });
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
        // Relative segments belong to the final playlist URL after redirects.
        const manifestUrl = allowedUrl(upstream.url || source.href, runtimeOrigins);
        const text = await upstream.text();
        if (!text.trimStart().startsWith('#EXTM3U')) {
          console.error('[stream-proxy] upstream response is not an HLS manifest', {
            source: `${source.origin}${source.pathname}`,
            type
          });
          return res.sendStatus(502);
        }
        const rewrite = (uri) => {
          const target = allowedUrl(new URL(uri, manifestUrl).href, runtimeOrigins);
          return `${config.api}/api/resource?resource=${seal(target.href, claims.jti)}`;
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
