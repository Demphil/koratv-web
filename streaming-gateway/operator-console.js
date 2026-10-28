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
import { readOperatorState, writeOperatorState, validateSelection, validateNotices, publicControlState, operatorMatchPaused } from './operator-state.js';
import { verifyOperatorPassword, sessionDigest, operatorCookie, readOperatorCookie } from './operator-auth.js';

const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const cookie = (token, age) => `${operatorCookie}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
export function registerOperatorConsole(app, { config, redis, clientIp, getMatches, prepareChannel, applyResources, status, beginOperation, endOperation, installVerifiedChannel = installPreparedOperatorChannel, matchWorker = runOperatorMatchWorker }) {
  const path = config.operatorControlPath || '/etc/koratv/operator-control.json';
  const mediaPath = config.operatorMediaPath || '/etc/koratv/operator-media';
  const clients = new Set();
  const connectionCounts = new Map();
  const jobs = new Map();
  const searchResults = new Map();
  let searching = false;
  let mutation = Promise.resolve(), operationQueue = Promise.resolve(), pendingOperations = 0, authenticating = false;
  const requests = new Map();
  const read = () => readOperatorState(path);
  const ownersOf = (provider, target, state) => {
    const assignments = config.providerAssignments?.().assignments || [];
    const own = assignments.find(item => item.matchId === target || item.aliases?.includes(target));
    const excluded = new Set([target, own?.matchId, ...(own?.aliases || []), ...(state.pauses?.[target]?.aliases || [])]);
    return [...new Set([
      ...Object.entries(state.providers || {}).filter(([, row]) => row.providerId === provider && row.day === moroccoMatchDay() && row.manual !== false).map(([id]) => id),
      ...assignments.filter(item => item.providerId === provider).flatMap(item => [item.matchId, ...(item.aliases || [])]),
      ...(status().accounts || []).filter(item => item.provider === provider).flatMap(item => item.matchIds || [])
    ])].filter(id => id && !excluded.has(id) && !operatorMatchPaused(state, id)).sort();
  };
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
  const icons = new Set(['refresh-cw', 'log-out', 'save', 'square', 'plus', 'send', 'arrow-up', 'arrow-down', 'x', 'radio', 'trash-2', 'play', 'eye', 'search', 'pin']);
  app.get('/api/operator/ui/icons/:name', async (req, res) => {
    if (!icons.has(req.params.name)) return res.sendStatus(404);
    res.type('svg').send(await readFile(join(dirname(require.resolve('lucide-static/package.json')), 'icons', `${req.params.name}.svg`), 'utf8'));
  });
  app.post('/api/operator/login', sameOrigin, async (req, res) => {
    if (!config.operatorPasswordHash) return res.status(503).json({ error: 'console_not_configured' });
    if (authenticating) return res.status(409).json({ error: 'login_in_progress' });
    authenticating = true;
    try {
      const key = `operator:login:${sessionDigest(clientIp(req))}`;
      if (Number(await redis.get(key) || 0) >= 6) return res.status(429).json({ error: 'too_many_attempts' });
      const valid = await verifyOperatorPassword(req.body?.password, config.operatorPasswordHash);
      if (req.body?.username !== 'admin' || !valid) {
        const attempts = await redis.incr(key);
        if (attempts === 1) await redis.expire(key, 900);
        return res.status(401).json({ error: 'invalid_login' });
      }
      await redis.del(key);
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
    const matches = await getMatches(), state = await read();
    const assignments = config.providerAssignments?.().assignments || [];
    res.json({ csrf: req.operatorSession.csrf, day: moroccoMatchDay(), state, matches: matches.map(match => {
      const assignment = assignments.find(item => item.matchId === match.matchId || item.aliases?.includes(match.matchId));
      return { ...match, paused: operatorMatchPaused(state, match.matchId), providerOwners: Object.fromEntries(Object.keys(config.providerAccounts?.() || {}).map(id => [id, ownersOf(id, match.matchId, state)])), assignedProvider: assignment?.providerId || '', boundProvider: sourceMatchState(match) !== 'ended' && state.providers?.[match.matchId]?.day === moroccoMatchDay() && state.providers[match.matchId].manual !== false ? state.providers[match.matchId].providerId : '' };
    }), status: status(), providers: Object.entries(config.providerAccounts?.() || {}).filter(([, account]) => account.enabled).map(([id]) => ({ id })),
      channels: [...new Set(matches.flatMap(match => [match.channelName, ...(match.broadcastChannels || [])]).filter(Boolean))].slice(0, 64).map(name => ({ name })),
      jobs: [...jobs.values()] });
  });
  app.get('/api/operator/channels', authorize, (req, res) => {
    const query = String(req.query.query || '').trim().toLowerCase();
    if (query.length < 2 || query.length > 100) return res.status(400).json({ error: 'invalid_channel_query' });
    const channels = [];
    for (const name of Object.keys(config.providerChannels?.() || {})) {
      if (name.toLowerCase().includes(query)) channels.push({ name });
      if (channels.length === 32) break;
    }
    res.json({ channels });
  });
  const runJob = (req, res, task, { exclusive = true, kind } = {}) => {
    const requestId = req.body?.requestId;
    if (requestId !== undefined && !/^[a-f0-9-]{36}$/i.test(requestId)) return res.status(400).json({ error: 'invalid_request' });
    const requestKey = requestId && `${sessionDigest(readOperatorCookie(req))}:${requestId}`;
    const existing = requestKey && jobs.get(requests.get(requestKey));
    if (existing) return res.status(202).json({ job: existing });
    if (exclusive && pendingOperations >= 8) return res.status(429).json({ error: 'queue_full' });
    if (exclusive) pendingOperations++;
    const job = { id: randomUUID(), state: exclusive ? 'queued' : 'running', phase: exclusive ? 'queued' : 'preparing', startedAt: new Date().toISOString(), matchId: req.body?.matchId,
      ...(Array.isArray(req.body?.matchIds) ? { matchIds: req.body.matchIds.filter(id => typeof id === 'string').slice(0, 8) } : {}), ...(kind ? { kind } : {}) };
    if (jobs.size >= 32) {
      const removable = [...jobs.values()].find(item => ['complete', 'failed'].includes(item.state));
      if (removable) { jobs.delete(removable.id); for (const [key, id] of requests) if (id === removable.id) requests.delete(key); }
    }
    jobs.set(job.id, job);
    if (requestKey) requests.set(requestKey, job.id);
    const executeJob = async () => {
      job.state = 'running'; job.phase = 'preparing';
      try { if (exclusive) await beginOperation?.(); await task(job); job.state = 'complete'; job.phase = 'ready'; }
      catch (error) { job.state = 'failed'; job.error = ['no_free_provider', 'channel_not_found', 'channel_probe_failed', 'invalid_selection', 'invalid_match', 'invalid_channel', 'search_expired', 'match_not_found', 'match_not_broadcastable', 'capacity_full', 'source_search_failed', 'invalid_provider', 'provider_busy', 'provider_reserved', 'provider_unavailable', 'provider_owner_changed', 'operator_paused'].includes(error.message) ? error.message : 'operation_failed'; console.warn('[operator-job]', { kind: job.kind, phase: job.phase, error: job.error, code: error.code || null }); }
      finally { job.finishedAt = new Date().toISOString(); if (exclusive) { pendingOperations--; await endOperation?.(); } }
    };
    if (exclusive) operationQueue = operationQueue.catch(() => {}).then(executeJob);
    else Promise.resolve().then(executeJob);
    res.status(202).json({ job });
  };
  app.post('/api/operator/matches/search', sameOrigin, authorize, csrf, async (req, res) => {
    if (req.body?.requestId !== undefined) return res.status(400).json({ error: 'invalid_request' });
    if (searching) return res.status(409).json({ error: 'operation_in_progress' });
    searching = true;
    let queued = false;
    try {
      const query = validateMatchSearch(req.body);
      const owner = sessionDigest(readOperatorCookie(req));
      const key = `operator:match-search:${owner}`;
      const attempts = await redis.incr(key);
      if (attempts === 1) await redis.expire(key, 3600);
      if (attempts > 30) return res.status(429).json({ error: 'search_rate_limited' });
      queued = true;
      return runJob(req, res, async job => {
        job.phase = 'searching_match';
        try {
          const result = await matchWorker('search', query);
          for (const [id, item] of searchResults) if (item.expiresAt <= Date.now()) searchResults.delete(id);
          const matches = (result.matches || []).slice(0, 12).map(row => {
            const candidateId = randomUUID();
            searchResults.set(candidateId, { owner, query, matchId: row.match_id, sourceMatchId: row.payload?.sourceMatchId, expiresAt: Date.now() + 5 * 60000 });
            return { candidateId, homeTeam: row.home_team, awayTeam: row.away_team, league: row.league, scheduledAt: row.kickoff_time,
              status: row.payload?.status, score: row.payload?.score, channels: row.payload?.channels || [],
              canImport: row.active !== false && sourceMatchState(row.payload) !== 'unavailable' };
          });
          while (searchResults.size > 120) searchResults.delete(searchResults.keys().next().value);
          job.result = { matches, day: query.day };
        } finally { searching = false; }
      }, { exclusive: false, kind: 'match_search' });
    } catch (error) { res.status(400).json({ error: ['invalid_team_names', 'search_expired'].includes(error.message) ? error.message : 'source_search_failed' }); }
    finally { if (!queued) searching = false; }
  });
  app.post('/api/operator/matches/import', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const candidate = searchResults.get(req.body?.candidateId);
    if (!candidate || candidate.expiresAt <= Date.now() || candidate.owner !== sessionDigest(readOperatorCookie(req))
      || candidate.query.day !== moroccoMatchDay()) throw new Error('search_expired');
    job.phase = 'searching_match';
    const { match } = await matchWorker('import', { ...candidate.query, matchId: candidate.matchId, sourceMatchId: candidate.sourceMatchId });
    if (!match || match.match_id !== candidate.matchId) throw new Error('invalid_match');
    job.matchId = match.match_id;
    job.published = true;
    job.displayOnly = true;
    await config.refreshMatchSnapshots?.();
    publish(await update(state => ({ ...state, channels: { ...state.channels, [match.match_id]: randomUUID() } })));
  }));
  app.post('/api/operator/selection', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const matches = await getMatches();
    const selection = validateSelection(req.body, new Set(matches.map(match => match.matchId)));
    const previous = (await read()).selection;
    await update(state => ({ ...state, selection }));
    job.phase = 'assigning';
    let applied;
    try { applied = await applyResources(); }
    catch (error) {
      await update(state => ({ ...state, selection: previous }));
      await applyResources().catch(() => {});
      throw error;
    }
    const affected = applied?.changedMatchIds || [...new Set([...(previous?.matches || []), ...selection.matches])].filter(id => previous?.matches?.includes(id) !== selection.matches.includes(id));
    await update(state => ({ ...state, channels: { ...state.channels, ...Object.fromEntries(affected.map(id => [id, randomUUID()])) } }));
    publish(await read());
  }, { kind: 'selection' }));
  app.post('/api/operator/matches/refresh', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    job.phase = 'refreshing_metadata';
    const before = await getMatches();
    const result = await matchWorker('refresh', {});
    await config.refreshMatchSnapshots?.();
    job.phase = 'assigning';
    await applyResources({ metadataOnly: true });
    const after = await getMatches();
    const endedIds = after.filter(match => sourceMatchState(match) === 'ended' && before.some(row => row.matchId === match.matchId && sourceMatchState(row) !== 'ended')).map(row => row.matchId);
    publish(await update(state => ({ ...state, metadataRefreshedAt: new Date().toISOString(), channels: { ...state.channels, ...Object.fromEntries(endedIds.map(id => [id, randomUUID()])) } })));
    job.result = result;
  }, { kind: 'metadata_refresh' }));
  app.post('/api/operator/matches/stop', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const match = (await getMatches()).find(row => row.matchId === req.body.matchId);
    if (!match || ['ended', 'unavailable'].includes(sourceMatchState(match))) throw new Error('invalid_match');
    const state = await read();
    const assignment = config.providerAssignments?.().assignments?.find(row => row.matchId === match.matchId || row.aliases?.includes(match.matchId));
    const ids = [...new Set([match.matchId, assignment?.matchId, ...(assignment?.aliases || []), ...(state.pauses?.[match.matchId]?.aliases || [])].filter(Boolean))];
    job.phase = 'stopping';
    publish(await update(current => {
      const pauses = { ...current.pauses }, providers = { ...current.providers }, channels = { ...current.channels };
      for (const id of ids) { pauses[id] = { day: moroccoMatchDay(), reason: 'manual_stop', aliases: ids, at: new Date().toISOString() }; delete providers[id]; channels[id] = randomUUID(); }
      return { ...current, pauses, providers, channels };
    }));
    config.refreshProviderCatalog?.();
    for (const id of ids) config.invalidatePlayback?.(id);
    try { await applyResources({ stopMatchIds: ids, metadataOnly: true }); }
    catch { job.warning = 'resource_reconciliation_pending'; }
    job.stopped = true;
  }, { kind: 'stop' }));
  const changeChannel = async (req, job, { refreshOnly = false, providerChange = false, verified = null } = {}) => {
    const matches = await getMatches(), match = matches.find(item => item.matchId === req.body.matchId);
    if (!match) throw new Error('invalid_match');
    if (['ended', 'unavailable'].includes(sourceMatchState(match))) throw new Error('invalid_match');
    const currentState = await read();
    if (operatorMatchPaused(currentState, match.matchId) && (refreshOnly || currentState.pauses[match.matchId].reason === 'manual_stop' && req.body.resume !== true)) throw new Error('operator_paused');
    const binding = currentState.providers?.[match.matchId];
    const requested = req.body.providerId ?? (binding?.day === moroccoMatchDay() && binding.manual !== false ? binding.providerId : '');
    if (typeof requested !== 'string' || requested && (!/^[A-J]$/.test(requested) || !config.providerAccounts?.()[requested]?.enabled)) throw new Error('invalid_provider');
    const owners = requested ? ownersOf(requested, match.matchId, currentState) : [];
    const takeover = req.body.takeover === true;
    if (owners.length && !takeover) throw new Error('provider_reserved');
    if (takeover && (!requested || !Array.isArray(req.body.expectedOwnerIds) || JSON.stringify([...new Set(req.body.expectedOwnerIds)].sort()) !== JSON.stringify(owners))) throw new Error('provider_owner_changed');
    const channel = String(refreshOnly || providerChange ? match.channelName || currentState.overrides[match.matchId]?.channel : req.body.channel || '').trim();
    if (!channel || channel.length > 100 || /https?:|[/\\\r\n]/i.test(channel)) throw new Error('invalid_channel');
    job.matchId = match.matchId;
    let prepared;
    if (verified) {
      if (currentState.revision !== verified.revision || !verified.guard() || verified.content?.status !== 'verified'
        || owners.length || requested !== verified.providerId || channel !== verified.channel
        || verified.result?.resolvedChannel !== channel || Object.keys(verified.result.provider_sources || {}).join() !== requested) throw new Error('content_change_obsolete');
      await installVerifiedChannel(verified.result);
      prepared = { name: channel, providerId: requested };
    } else prepared = await prepareChannel(channel, phase => { job.phase = phase; }, match, { providerId: requested, ...(takeover ? { takeover: true } : {}) });
    // Persist only after a media segment has passed the bounded probe.
    job.phase = 'saving';
    const previous = (await read()).overrides[match.matchId];
    const targetIds = [match.matchId, ...(currentState.pauses?.[match.matchId]?.aliases || [])];
    const affected = [...new Set([...targetIds, ...owners])];
    await update(state => {
      const providers = { ...state.providers }, pauses = { ...state.pauses };
      for (const id of targetIds) delete pauses[id];
      for (const id of owners) {
        const assignment = config.providerAssignments?.().assignments?.find(row => row.matchId === id || row.aliases?.includes(id));
        delete providers[id]; pauses[id] = { day: moroccoMatchDay(), aliases: assignment ? [assignment.matchId, ...(assignment.aliases || [])] : [id], displacedBy: match.matchId, at: new Date().toISOString() };
      }
      if (prepared.providerId) providers[match.matchId] = { providerId: prepared.providerId, day: moroccoMatchDay(), manual: verified ? false : Boolean(requested), verifiedAt: new Date().toISOString(), ...(verified ? { source: 'content-verification' } : {}) };
      return { ...state, providers, pauses, overrides: { ...state.overrides, [match.matchId]: { channel: prepared.name, expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(), enabled: true } } };
    });
    job.phase = 'assigning';
    const scope = { matchId: match.matchId, ...(verified ? { preserveUnrelated: true } : {}), ...(owners.length ? { displacedMatchIds: owners, takeoverProvider: requested } : {}), ...(sourceMatchState(match) === 'upcoming' && !match.isLive ? { allowDeferred: true } : {}) };
    try { await applyResources(scope); }
    catch (error) {
      await update(state => { const overrides = { ...state.overrides }, providers = { ...state.providers }; if (previous) overrides[match.matchId] = previous; else delete overrides[match.matchId];
        const pauses = { ...state.pauses };
        for (const id of affected) { if (currentState.providers?.[id]) providers[id] = currentState.providers[id]; else delete providers[id]; if (currentState.pauses?.[id]) pauses[id] = currentState.pauses[id]; else delete pauses[id]; }
        return { ...state, overrides, providers, pauses }; });
      await applyResources(owners.length ? {} : scope).catch(() => {});
      throw error;
    }
    await update(state => ({ ...state, channels: { ...state.channels, ...Object.fromEntries(affected.map(id => [id, randomUUID()])) } }));
    publish(await read());
    job.channel = prepared.name;
    job.provider = prepared.providerId;
    job.displacedMatchIds = owners;
  };
  app.post('/api/operator/channel', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, job => changeChannel(req, job), { kind: 'channel' }));
  app.post('/api/operator/provider', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, job => changeChannel(req, job, { providerChange: true }), { kind: 'provider' }));
  app.post('/api/operator/matches/resume', sameOrigin, authorize, csrf, (req, res) => runJob(req, res,
    job => changeChannel({ body: { ...req.body, resume: true } }, job, { providerChange: true }), { kind: 'resume' }));
  app.post('/api/operator/refresh-links', sameOrigin, authorize, csrf, (req, res) => runJob(req, res, async job => {
    const ids = req.body.matchId ? [req.body.matchId] : req.body.matchIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length) throw new Error('invalid_selection');
    job.results = [];
    job.matchIds = ids;
    job.total = ids.length;
    for (const matchId of ids) {
      job.matchId = matchId;
      try { const item = { set phase(value) { job.phase = value; } }; await changeChannel({ body: { matchId } }, item, { refreshOnly: true }); job.results.push({ matchId, ok: true, provider: item.provider }); }
      catch (error) { job.results.push({ matchId, ok: false, error: ['provider_busy','provider_reserved','provider_unavailable','no_free_provider','channel_not_found','channel_probe_failed','invalid_match','invalid_channel','operator_paused'].includes(error.message) ? error.message : 'operation_failed' }); }
      job.completed = job.results.length;
    }
    if (job.results.every(item => !item.ok)) throw new Error('channel_probe_failed');
  }, { kind: 'refresh' }));
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
  return { publish, read, update, busy: () => pendingOperations > 0,
    applyVerifiedChannel(input) {
      if (pendingOperations > 0) return Promise.resolve({ status: 'operator_busy' });
      pendingOperations++;
      const task = operationQueue.catch(() => {}).then(async () => {
        try {
          await beginOperation?.();
          const job = { kind: 'content_repair', matchId: input.matchId, phase: 'verifying_content' };
          await changeChannel({ body: { matchId: input.matchId, providerId: input.providerId, channel: input.channel } }, job, { verified: input });
          return { status: 'corrected', provider: input.providerId, channel: input.channel };
        } finally { pendingOperations--; await endOperation?.(); }
      });
      operationQueue = task.catch(() => {});
      return task;
    }
  };
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
  const workerEnv = mode === 'refresh' ? { ...env, MATCH_SOURCE_PROVIDER: 'kooora', KOOORA_DETAIL_CHANNEL_LIMIT: '0' } : env;
  try { ({ stdout } = await execute(process.execPath, [script, mode, JSON.stringify(input)], { env: workerEnv, timeout: 180000, maxBuffer: 512 * 1024 })); }
  catch (error) { stdout = error.stdout; if (!stdout) throw new Error('source_search_failed'); }
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('source_search_failed'); }
  if (result.error) throw new Error(result.error);
  return result;
}
