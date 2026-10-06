import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerOperatorConsole } from '../operator-console.js';
import { hashOperatorPassword, verifyOperatorPassword } from '../operator-auth.js';
import { validateSelection, validateNotices, publicControlState, emptyOperatorState, activeOperatorOverride } from '../operator-state.js';
import { createProviderCatalog } from '../provider-catalog.js';
import { loadConfig } from '../config.js';
import { createApp } from '../app.js';

test('private console exposes only the exact fixture broadcasters, not channels from unrelated matches', async t => {
  const values = new Map();
  const redis = { get: async key => values.get(key), set: async (key, value) => values.set(key, value), del: async key => values.delete(key), incr: async key => { const next = Number(values.get(key) || 0) + 1; values.set(key, next); return next; }, expire: async () => {} };
  const dir = await mkdtemp(join(tmpdir(), 'operator-broadcast-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const password = 'local-only-broadcast-test-password';
  const config = { secret: 'test-secret-longer-than-32-characters', hmacSecret: 'independent-hmac-longer-than-32-characters',
    frontend: 'https://koratv.click', player: 'https://fabor.sbs', api: '', frontendOrigins: new Set(['https://koratv.click']), upstreamOrigins: new Set(), trustedProxies: [], enableAntiBot: false,
    operatorPasswordHash: await hashOperatorPassword(password), operatorControlPath: join(dir, 'control.json'),
    getMatchesForOrigin: async () => [
      { id: 'gulf-final', match_id: 'gulf-final', home_team: 'Saudi Arabia', away_team: 'United Arab Emirates', league: 'كأس الخليج', kickoff_time: new Date().toISOString(), active: true,
        channel: 'MBC Action', payload: { status: 'FIXTURE', broadcast: { source: 'kooora', channels: ['MBC Action', 'AL KASS One'] } } },
      { id: 'other-fixture', match_id: 'other-fixture', home_team: 'France', away_team: 'England', league: 'المباريات الودية', kickoff_time: new Date().toISOString(), active: true,
        channel: 'beIN SPORTS HD 1', payload: { status: 'FIXTURE', broadcast: { source: 'kooora', channels: ['beIN SPORTS HD 1'] } } }
    ] };
  const server = createApp({ config, redis }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  config.api = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(config.api + '/api/operator/login', { method: 'POST', headers: { Origin: config.api, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
  assert.equal(login.status, 200);
  const response = await fetch(config.api + '/api/operator/state', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
  const snapshot = await response.json();
  assert.deepEqual(snapshot.matches.find(row => row.matchId === 'gulf-final').broadcastChannels, ['MBC Action', 'AL KASS One']);
  assert.deepEqual(snapshot.matches.find(row => row.matchId === 'other-fixture').broadcastChannels, ['beIN SPORTS HD 1']);
  assert.equal((await fetch(config.api + '/api/operator/state')).status, 401);
});

test('operator origin is independent from a legacy player API origin', () => {
  const config = loadConfig({ JWT_SECRET: 'test-operator-jwt-secret-over-32-bytes', HMAC_SECRET: 'test-independent-hmac-secret-over-32-bytes', PUBLIC_API_ORIGIN: 'https://fabor.sbs', NEXT_PUBLIC_SUPABASE_URL: 'https://storage.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-key' });
  assert.equal(config.api, 'https://fabor.sbs');
  assert.equal(config.operatorOrigin, 'https://stream-api.koratv.click');
  assert.equal(config.operatorConsolePath, '');
});

test('console address is configured privately and rejects URL query or route patterns', () => {
  const env = { JWT_SECRET: 'test-operator-jwt-secret-over-32-bytes', HMAC_SECRET: 'test-independent-hmac-secret-over-32-bytes', PUBLIC_API_ORIGIN: 'https://api.example', NEXT_PUBLIC_SUPABASE_URL: 'https://storage.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-key' };
  assert.equal(loadConfig({ ...env, BROADCAST_ADMIN_CONSOLE_PATH: '/fixture-private-console' }).operatorConsolePath, '/fixture-private-console');
  for (const path of ['/private?token=key', '/private/:parameter', 'https://private.example']) assert.throws(() => loadConfig({ ...env, BROADCAST_ADMIN_CONSOLE_PATH: path }), /Invalid private console path/);
});

test('operator selections and notice schedules reject invalid limits and raw markup stays plain text', () => {
  const available = new Set(['a', 'b']);
  assert.deepEqual(validateSelection({ enabled: true, matches: ['b', 'a'] }, available).matches, ['b', 'a']);
  for (const matches of [['a', 'a'], ['unknown'], Array.from({ length: 9 }, (_, i) => String(i))]) assert.throws(() => validateSelection({ enabled: true, matches }, available));
  const valid = { enabled: true, items: [{ text: '<script>no execution</script>', image: '' }], repeats: 2, duration: 5, interval: 5, matchIds: [] };
  assert.equal(validateNotices(valid).items[0].text, valid.items[0].text);
  assert.throws(() => validateNotices({ ...valid, repeats: 0 }));
  const screenshotSettings = validateNotices({ ...valid, repeats: 1000, duration: 30, interval: 100 });
  assert.equal(screenshotSettings.repeats, 1000);
  assert.equal(screenshotSettings.duration, 30);
  assert.equal(screenshotSettings.interval, 100);
  for (const repeats of [1001, 1.5, '1000', NaN]) assert.throws(() => validateNotices({ ...valid, repeats }));
  assert.throws(() => validateNotices({ ...valid, duration: 121 }));
  assert.throws(() => validateNotices({ ...valid, items: [{ text: 'x', image: 'javascript:alert(1)' }] }));
  const state = { ...emptyOperatorState(), selection: { matches: ['private-match'] }, overrides: { 'private-match': { channel: 'private' } }, channels: { 'private-match': 'version' } };
  assert.equal(JSON.stringify(publicControlState(state)).includes('private-match'), false);
  assert.equal(JSON.stringify(publicControlState(state)).includes('overrides'), false);
});

test('operator login, CSRF, protected jobs, image validation and realtime notice stop', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'operator-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const password = 'test-only-long-private-password';
  const hash = await hashOperatorPassword(password);
  assert.equal(await verifyOperatorPassword('wrong', hash), false);
  const values = new Map();
  const redis = { get: async key => values.get(key), set: async (key, value) => values.set(key, value), del: async key => values.delete(key), incr: async key => { const next = Number(values.get(key) || 0) + 1; values.set(key, next); return next; }, expire: async () => {} };
  const config = { api: '', operatorConsolePath: '/fixture-private-console', operatorPasswordHash: hash, operatorControlPath: join(dir, 'control.json'), operatorMediaPath: join(dir, 'media'), providerChannels: () => ({ 'On Sport Plus': { sourceNames: { A: 'EG On Sport Plus HD' }, A: 'https://secret/user/password' } }) };
  const app = express(); app.use(express.json({ limit: '260kb' }));
  let channelCalls = 0, applyCalls = 0, failAssignment = false;
  registerOperatorConsole(app, { config, redis, clientIp: () => 'test-ip', getMatches: async () => [{ matchId: 'fixture', homeTeam: 'Home', awayTeam: 'Away' }],
    prepareChannel: async () => { channelCalls++; if (!failAssignment) throw new Error('channel_probe_failed'); return { name: 'New Channel' }; },
    applyResources: async options => { applyCalls++; if (failAssignment && options?.matchId === 'fixture') throw new Error('channel_probe_failed'); }, status: () => ({}) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  config.api = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const get = (path, headers = {}) => fetch(config.api + path, { headers });
  const post = (path, body, headers = {}) => fetch(config.api + path, { method: 'POST', headers: { Origin: config.api, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await get(config.operatorConsolePath)).status, 200);
  assert.equal((await get('/api/operator/state')).status, 401);
  assert.equal((await post('/api/operator/login', { username: 'admin', password }, { Origin: 'https://evil.test' })).status, 403);
  const login = await post('/api/operator/login', { username: 'admin', password }); assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie'); assert.match(setCookie, /Secure; HttpOnly; SameSite=Strict/); assert.match(setCookie, /^__Host-/);
  const credentials = { Cookie: setCookie.split(';')[0], 'X-Operator-CSRF': (await login.json()).csrf };
  const state = await (await get('/api/operator/state', credentials)).json();
  assert.equal(JSON.stringify(state).includes('https://secret'), false);
  assert.equal(JSON.stringify(state).includes(config.operatorConsolePath), false);
  assert.equal((await post('/api/operator/selection', { enabled: true, matches: ['fixture'] }, { Cookie: credentials.Cookie })).status, 403);
  const jobResponse = await post('/api/operator/channel', { matchId: 'fixture', channel: 'New Channel' }, credentials); assert.equal(jobResponse.status, 202);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(channelCalls, 1); assert.equal(applyCalls, 0);
  await assert.rejects(readFile(config.operatorControlPath));
  failAssignment = true;
  const failedAssignment = await post('/api/operator/channel', { matchId: 'fixture', channel: 'New Channel' }, credentials);
  const failedJobId = (await failedAssignment.json()).job.id;
  await new Promise(resolve => setTimeout(resolve, 40));
  const afterFailure = await (await get('/api/operator/state', credentials)).json();
  assert.equal(afterFailure.jobs.find(job => job.id === failedJobId).state, 'failed');
  assert.equal(afterFailure.state.overrides.fixture, undefined);
  assert.equal(afterFailure.state.channels.fixture, undefined);
  assert.equal(applyCalls, 2);
  failAssignment = false;
  const selection = await post('/api/operator/selection', { enabled: true, matches: ['fixture'] }, credentials); assert.equal(selection.status, 202);
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(applyCalls, 3);
  const controller = new AbortController();
  const stream = await fetch(`${config.api}/api/broadcast-events`, { signal: controller.signal }); const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: control/);
  const notice = { enabled: true, items: [{ text: 'Live notice', image: '' }], repeats: 1000, duration: 30, interval: 100, matchIds: [] };
  assert.equal((await post('/api/operator/notices', notice, credentials)).status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /Live notice/);
  const persistedNotice = (await (await get('/api/operator/state', credentials)).json()).state.notices;
  for (const key of ['repeats', 'duration', 'interval']) assert.equal(persistedNotice[key], notice[key]);
  assert.equal((await post('/api/operator/notices', { ...notice, repeats: 1001 }, credentials)).status, 400);
  assert.equal((await (await get('/api/operator/state', credentials)).json()).state.notices.campaign, persistedNotice.campaign);
  assert.equal((await post('/api/operator/notices/stop', {}, credentials)).status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"enabled":false/);
  controller.abort();
  assert.equal((await post('/api/operator/image', { image: 'data:image/png;base64,aW52YWxpZA==' }, credentials)).status, 400);
  assert.equal((await post('/api/operator/logout', {}, credentials)).status, 200);
  assert.equal((await get('/api/operator/state', credentials)).status, 401);
});

test('operator broadcaster correction wins over repository files and expires safely', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'operator-catalog-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const operator = { overrides: { fixture: { channel: 'On Sport Plus', enabled: true, expiresAt: new Date(Date.now() + 60000).toISOString() } } };
  await writeFile(join(dir, 'operator.json'), JSON.stringify(operator));
  await writeFile(join(dir, 'old.json'), JSON.stringify({ matches: { fixture: { channel: 'Old Channel', expiresAt: new Date(Date.now() + 60000).toISOString() } } }));
  const catalog = createProviderCatalog({ OPERATOR_CONTROL_PATH: join(dir, 'operator.json'), MANUAL_BROADCAST_OVERRIDE_PATH: join(dir, 'old.json') });
  assert.equal(catalog.override('fixture'), 'On Sport Plus');
  assert.equal(activeOperatorOverride(operator, 'fixture', Date.now() + 120000), null);
});
