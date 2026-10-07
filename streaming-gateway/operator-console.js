import express from 'express';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { access } from 'node:fs/promises';
import { validateMatchSearch } from '../shared/operator-match-search.mjs';
import { moroccoMatchDay } from '../shared/operator-imported-match.mjs';
import { sourceMatchState } from '../shared/match-lifecycle.mjs';
import { broadcastChannelCandidates } from '../shared/match-broadcasts.mjs';
import { currentConsoleSelection } from './operator/selection.js';
import { readOperatorState, writeOperatorState, validateSelection, validateNotices, publicControlState } from './operator-state.js';
import { verifyOperatorPassword, sessionDigest, operatorCookie, readOperatorCookie } from './operator-auth.js';

const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const cookie = (token, age) => `${operatorCookie}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
export function registerOperatorConsole(app, { config, redis, clientIp, getMatches, prepareChannel, applyResources, status, matchWorker = runOperatorMatchWorker }) {
  const path = config.operatorControlPath || '/etc/koratv/operator-control.json';
  const mediaPath = config.operatorMediaPath || '/etc/koratv/operator-media';
  const clients = new Set();
  const connectionCounts = new Map();
  const jobs = new Map();
  const searchResults = new Map();
  let searching = false;
  let mutation = Promise.resolve(), operation = false, authenticating = false;
  const read = () => readOperatorState(path);
  const update = change => {
    const work = mutation.catch(() => {}).then(async () => {
      const previous = await read();
      const next = await change(previous);
      next.revision = previous.revision + 1;
      next.updatedAt = new Date().toISOString();
      await writeOperatorState(path, next);
      return next;
    });
    mutation = work;
    return work;
  };
  const publish = state => {
    const payload = `event: control\ndata: ${JSON.stringify(publicControlState(state))}\n\n`;
    for (const response of clients) {
      if (response.writableLength > 256 * 1024) { response.end(); clients.delete(response); }
      else response.write(payload);
    }
  };
  const sameOrigin = (req, res, next) => req.headers.origin === (config.operatorOrigin || config.api) ? next() : res.status(403).json({ error: 'origin_rejected' });
  const authorize = async (req, res, next) => {
    try {
      const token = readOperatorCookie(req);
      const session = token && await redis.get(`operator:session:${sessionDigest(token)}`);
      if (!session) return res.status(401).json({ error: 'login_required' });
      req.operatorSession = JSON.parse(session);
      if (req.operatorSession.passwordVersion !== sessionDigest(config.operatorPasswordHash || '')) return res.status(401).json({ error: 'login_required' });
      next();
    } catch { res.status(503).json({ error: 'authentication_unavailable' }); }
  };
  const csrf = (req, res, next) => req.headers['x-operator-csrf'] === req.operatorSession.csrf ? next() : res.status(403).json({ error: 'csrf_rejected' });
  if (config.operatorConsolePath) app.get(config.operatorConsolePath, async (req, res) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'X-Frame-Options': 'DENY' });
    res.type('html').send(await readFile(new URL('./operator/console.html', import.meta.url), 'utf8'));
  });
  for (const asset of ['console.js', 'selection.js', 'console.css', 'notice-editor.css', 'depth.js', 'theme.css']) app.get(`/api/operator/ui/${asset}`, async (req, res) => res.type(asset.endsWith('.js') ? 'js' : 'css').send(await readFile(new URL(`./operator/${asset}`, import.meta.url), 'utf8')));
  for (const asset of ['three.module.min.js', 'three.core.min.js']) app.get(`/api/operator/ui/${asset}`, async (req, res) => res.type('js').send(await readFile(join(dirname(require.resolve('three')), asset), 'utf8')));
  app.get('/api/operator/ui/broadcast-notice.css', async (req, res) => res.type('css').send(await readFile(new URL('./player/broadcast-notice.css', import.meta.url), 'utf8')));
  app.get('/api/operator/ui/broadcast-notice.js', async (req, res) => res.type('js').send(await readFile(new URL('./player/broadcast-notice.js', import.meta.url), 'utf8')));
  const icons = new Set(['refresh-cw', 'log-out', 'save', 'square', 'plus', 'send', 'arrow-up', 'arrow-down', 'x', 'radio', 'trash-2', 'play', 'eye', 'search']);
  app.get('/api/operator/ui/icons/:name', async (req, res) => {
    if (!icons.has(req.params.name)) return res.sendStatus(404);
    res.type('svg').send(await readFile(join(dirname(require.resolve('lucide-static/package.json')), 'icons', `${req.params.name}.svg`), 'utf8'));
  });
  app.post('/api/operator/login', sameOrigin, async (req, res) => {
    if (!config.operatorPasswordHash) return res.status(503).json({ error: 'console_not_configured' });
    if (authenticating) return res.status(429).json({ error: 'too_many_attempts' });
    authenticating = true;
    try {
      const key = `operator:login:${sessionDigest(clientIp(req))}`;
      const attempts = await redis.incr(key);
      if (attempts === 1) await redis.expire(key, 900);
      if (attempts > 6) return res.status(429).json({ error: 'too_many_attempts' });
      const valid = await verifyOperatorPassword(req.body?.password, config.operatorPasswordHash);
      if (req.body?.username !== 'admin' || !valid) return res.status(401).json({ error: 'invalid_login' });
      const token = randomBytes(32).toString('hex'), csrfToken = randomBytes(24).toString('hex');
      await redis.set(`operator:session:${sessionDigest(token)}`, JSON.stringify({ csrf: csrfToken, passwordVersion: sessionDigest(config.operatorPasswordHash) }), { EX: 7200 });
      res.set('Set-Cookie', cookie(token, 7200)).json({ csrf: csrfToken });
    } catch { res.status(503).json({ error: 'authentication_unavailable' }); }
    finally { authenticating = false; }
  });
  app.post('/api/operator/logout', sameOrigin, authorize, csrf, async (req, res) => {
    await redis.del(`operator:session:${sessionDigest(readOperatorCookie(req))}`);
    res.set('Set-Cookie', cookie('', 0)).json({ ok: true });
  });
  app.get('/api/operator/state', authorize, async (req, res) => {
    const matches = await getMatches();
    res.json({ csrf: req.operatorSession.csrf, day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date()), state: await read(), matches, status: status(),
      channels: Object.entries(config.providerChannels?.() || {}).map(([name, entry]) => ({ name, sources: Object.entries(entry.sourceNames || {}).map(([provider, sourceName]) => ({ provider, name: sourceName })) })),
      jobs: [...jobs.values()] });
  });
  const runJob = (req, res, task) => {
    if (operation) return res.status(409).json({ error: 'operation_in_progress' });
    operation = true;
    const job = { id: randomUUID(), state: 'running', phase: 'preparing', startedAt: new Date().toISOString() };
    if (jobs.size > 10) jobs.delete(jobs.keys().next().value);
    jobs.set(job.id, job);
    Promise.resolve().then(() => task(job)).then(() => { job.state = 'complete'; job.phase = 'ready'; })
      .catch(error => { job.state = 'failed'; job.error = ['no_free_provider', 'channel_not_found', 'channel_probe_failed', 'invalid_selection', 'invalid_match', 'invalid_channel', 'search_expired', 'match_not_found', 'match_not_broadcastable', 'capacity_full', 'source_search_failed'].includes(error.message) ? error.message : 'operation_failed'; })
      .finally(() => { operation = false; });
    res.status(202).json({ job });
  };
  app.post('/api/operator/matches/search', sameOrigin, authorize, csrf, async (req, res) => {
    if (searching) return res.status(409).json({ error: 'operation_in_progress' });
    searching = true;
    try {
      const query = validateMatchSearch(req.body);
      const owner = sessionDigest(readOperatorCookie(req));
      const key = `operator:match-search:${owner}`;
      const attempts = await redis.incr(key);
      if (attempts === 1) await redis.expire(key, 3600);
      if (attempts > 30) return res.status(429).json({ error: 'search_rate_limited' });
      const result = await matchWorker('search', query);
      for (const [id, item] of searchResults) if (item.expiresAt <= Date.now()) searchResults.delete(id);
      const matches = (result.matches || []).slice(0, 12).map(row => {
        const candidateId = randomUUID();
        searchResults.set(candidateId, { owner, query, matchId: row.match_id, sourceMatchId: row.payload?.sourceMatchId, expiresAt: Date.now() + 5 * 60000 });
        return { candidateId, homeTeam: row.home_team, awayTeam: row.away_team, league: row.league, scheduledAt: row.kickoff_time,
          status: row.payload?.status, score: row.payload?.score, channels: row.payload?.channels || [],
          canImport: row.active !== false && !['ended', 'unavailable'].includes(sourceMatchState(row.payload)) };
      });
      while (searchResults.size > 120) searchResults.delete(searchResults.keys().next().value);
      res.json({ matches, day: query.day });
    } catch (error) { res.status(400).json({ error: ['invalid_team_names', 'search_expired'].includes(error.message) ? error.message : 'source_search_failed' }); }
    finally { searching = false; }
  });
  app.post('/api/operator/matches/import', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const candidate = searchResults.get(req.body?.candidateId);
    if (!candidate || candidate.expiresAt <= Date.now() || candidate.owner !== sessionDigest(readOperatorCookie(req))
      || candidate.query.day !== moroccoMatchDay()) throw new Error('search_expired');
    const previous = await read(), matches = await getMatches();
    const selection = currentConsoleSelection({ state: previous.selection?.enabled === true ? previous : { ...previous, selection: null }, matches, day: candidate.query.day });
    if (selection.matches.length >= 8 && !selection.matches.includes(candidate.matchId)) throw new Error('capacity_full');
    job.phase = 'searching_match';
    const { match } = await matchWorker('import', { ...candidate.query, matchId: candidate.matchId, sourceMatchId: candidate.sourceMatchId });
    if (!match || match.match_id !== candidate.matchId) throw new Error('invalid_match');
    job.matchId = match.match_id;
    job.published = true;
    await config.refreshMatchSnapshots?.();
    publish(await update(state => ({ ...state, channels: { ...state.channels, [match.match_id]: randomUUID() } })));
    let channel;
    for (const name of broadcastChannelCandidates(match).slice(0, 3)) {
      const canonical = config.resolveOperatorChannel?.(name) || name;
      const entry = config.providerChannels?.()[canonical];
      if (entry && Object.keys(config.providerAccounts?.() || {}).some(id => entry[id])) { channel = canonical; break; }
      try { channel = (await prepareChannel(name, phase => { job.phase = phase; }, { matchId: match.match_id })).name; break; }
      catch (error) { if (error.message !== 'channel_not_found') throw error; }
    }
    if (!channel) throw new Error('channel_not_found');
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const ids = [...new Set([...selection.matches, match.match_id])];
    await update(state => ({ ...state, selection: { enabled: true, date: candidate.query.day, matches: ids, source: 'operator-console' },
      overrides: { ...state.overrides, [match.match_id]: { enabled: true, channel, expiresAt } } }));
    job.phase = 'assigning';
    const due = sourceMatchState(match.payload) === 'live' || Date.parse(match.kickoff_time) <= Date.now() + (config.streamOpensBeforeMinutes ?? 20) * 60000;
    try { await applyResources(due ? { matchId: match.match_id } : {}); }
    catch (error) {
      await update(state => {
        const overrides = { ...state.overrides };
        if (previous.overrides[match.match_id]) overrides[match.match_id] = previous.overrides[match.match_id];
        else delete overrides[match.match_id];
        return { ...state, selection: previous.selection, overrides };
      });
      await applyResources().catch(() => {});
      publish(await read());
      throw error;
    }
    job.channel = channel;
    job.scheduled = !due;
    publish(await update(state => ({ ...state, channels: { ...state.channels, [match.match_id]: randomUUID() } })));
  }));
  app.post('/api/operator/selection', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const matches = await getMatches();
    const selection = validateSelection(req.body, new Set(matches.map(match => match.matchId)));
    const previous = (await read()).selection;
    await update(state => ({ ...state, selection }));
    job.phase = 'assigning';
    try { await applyResources(); }
    catch (error) {
      await update(state => ({ ...state, selection: previous }));
      await applyResources().catch(() => {});
      throw error;
    }
    await update(state => ({ ...state, channels: Object.fromEntries(matches.map(match => [match.matchId, randomUUID()])) }));
    publish(await read());
  }));
  app.post('/api/operator/channel', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const matches = await getMatches(), match = matches.find(item => item.matchId === req.body.matchId);
    if (!match) throw new Error('invalid_match');
    const channel = String(req.body.channel || '').trim();
    if (!channel || channel.length > 100 || /https?:|[/\\\r\n]/i.test(channel)) throw new Error('invalid_channel');
    job.matchId = match.matchId;
    const prepared = await prepareChannel(channel, phase => { job.phase = phase; }, match);
    // Persist only after a media segment has passed the bounded probe.
    job.phase = 'saving';
    const previous = (await read()).overrides[match.matchId];
    await update(state => ({ ...state, overrides: { ...state.overrides, [match.matchId]: { channel: prepared.name, expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(), enabled: true } } }));
    job.phase = 'assigning';
    try { await applyResources({ matchId: match.matchId }); }
    catch (error) {
      await update(state => { const overrides = { ...state.overrides }; if (previous) overrides[match.matchId] = previous; else delete overrides[match.matchId]; return { ...state, overrides }; });
      await applyResources().catch(() => {});
      throw error;
    }
    await update(state => ({ ...state, channels: { ...state.channels, [match.matchId]: randomUUID() } }));
    publish(await read());
    job.channel = prepared.name;
  }));
  app.post('/api/operator/notices', sameOrigin, authorize, csrf, async (req, res) => {
    try {
      const notices = validateNotices(req.body);
      const known = new Set((await getMatches()).map(match => match.matchId));
      if (notices.matchIds.some(id => !known.has(id))) throw new Error('invalid_notices');
      for (const item of notices.items) if (item.image && !/^\/api\/notice-images\/[a-f0-9-]{36}$/.test(item.image)) throw new Error('invalid_notice');
      publish(await update(state => ({ ...state, notices })));
      res.json({ ok: true });
    } catch { res.status(400).json({ error: 'invalid_notices' }); }
  });
  app.post('/api/operator/notices/stop', sameOrigin, authorize, csrf, async (req, res) => {
    publish(await update(state => ({ ...state, notices: { ...state.notices, enabled: false } })));
    res.json({ ok: true });
  });
  app.post('/api/operator/image', sameOrigin, authorize, csrf, async (req, res) => {
    const uploadKey = `operator:upload:${sessionDigest(readOperatorCookie(req))}`;
    const uploads = await redis.incr(uploadKey);
    if (uploads === 1) await redis.expire(uploadKey, 3600);
    if (uploads > 30) return res.status(429).json({ error: 'too_many_uploads' });
    const match = String(req.body?.image || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: 'invalid_image' });
    const bytes = Buffer.from(match[2], 'base64');
    const type = bytes.subarray(0, 8).toString('hex').startsWith('89504e470d0a1a0a') ? 'png'
      : bytes.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
    if (type !== match[1] || bytes.length > 180 * 1024) return res.status(400).json({ error: 'invalid_image' });
    const id = randomUUID();
    await mkdir(mediaPath, { recursive: true, mode: 0o700 });
    await writeFile(join(mediaPath, id), bytes, { mode: 0o600 });
    await writeFile(join(mediaPath, `${id}.type`), type, { mode: 0o600 });
    res.json({ image: `/api/notice-images/${id}` });
  });
  app.get('/api/notice-images/:id', async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) return res.sendStatus(404);
    try {
      const type = await readFile(join(mediaPath, `${req.params.id}.type`), 'utf8');
      res.type(`image/${type}`).set('Cache-Control', 'public, max-age=86400').send(await readFile(join(mediaPath, req.params.id)));
    } catch { res.sendStatus(404); }
  });
  app.get('/api/broadcast-control', async (req, res) => res.json(publicControlState(await read())));
  app.get('/api/broadcast-events', async (req, res) => {
    const ip = clientIp(req);
    if ((connectionCounts.get(ip) || 0) >= 5 || clients.size >= 2000) return res.sendStatus(429);
    const initial = publicControlState(await read());
    res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    clients.add(res);
    connectionCounts.set(ip, (connectionCounts.get(ip) || 0) + 1);
    res.write(`retry: 5000\nevent: control\ndata: ${JSON.stringify(initial)}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    heartbeat.unref();
    req.on('close', () => { clearInterval(heartbeat); clients.delete(res); const count = (connectionCounts.get(ip) || 1) - 1; if (count) connectionCounts.set(ip, count); else connectionCounts.delete(ip); });
  });
  return { publish, read, update };
}

export async function installPreparedOperatorChannel(result, env = process.env) {
  const dir = env.PROVIDER_POOL_DIR || '/etc/koratv';
  const temporary = join(dir, `operator-channel-${randomUUID()}.json`);
  const names = Object.fromEntries(result.attempts.filter(item => item.status === 'matched').map(item => [item.provider, { name: item.matched, group: item.group || '' }]));
  await writeFile(temporary, JSON.stringify({ name: result.resolvedChannel, sources: result.provider_sources, names }), { mode: 0o600 });
  try { await execute('flock', ['-w', '45', `${dir}/provider-catalog.lock`, process.execPath, 'scripts/operator-catalog-install.mjs', temporary], { cwd, timeout: 50000, maxBuffer: 8192 }); }
  finally { await unlink(temporary).catch(() => {}); }
}
export async function refreshOperatorResources(env = process.env) {
  const dir = env.PROVIDER_POOL_DIR || '/etc/koratv';
  for (const [lock, script] of [['direct-match-route-state', 'maintenance-sync.js'], ['match-resource-assignment', 'resource-assignment.js']]) {
    await execute('flock', ['-w', '45', `${dir}/${lock}.lock`, process.execPath, `scripts/${script}`], { cwd, env, timeout: 65000, maxBuffer: 32768 });
  }
}

export async function runOperatorMatchWorker(mode, input, env = process.env) {
  let script = env.OPERATOR_MATCH_WORKER_PATH || fileURLToPath(new URL('../secure-streaming/scripts/operator-match-import.mjs', import.meta.url));
  try { await access(script); }
  catch { script = '/home/ubuntu/iptv-system/secure-streaming/scripts/operator-match-import.mjs'; }
  let stdout;
  try { ({ stdout } = await execute(process.execPath, [script, mode, JSON.stringify(input)], { env, timeout: 120000, maxBuffer: 512 * 1024 })); }
  catch (error) { stdout = error.stdout; if (!stdout) throw new Error('source_search_failed'); }
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('source_search_failed'); }
  if (result.error) throw new Error(result.error);
  return result;
}
