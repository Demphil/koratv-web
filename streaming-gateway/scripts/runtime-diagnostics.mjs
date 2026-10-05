import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const report = (name, data) => console.log(JSON.stringify({ name, data }));
const moduleAt = name => import(pathToFileURL(resolve(process.cwd(), name)).href);
const { createProviderCatalog } = await moduleAt('provider-catalog.js');
const { createPlaybackResolver } = await moduleAt('supabase.js');
const catalog = createProviderCatalog(process.env);
if (process.env.DIAGNOSTICS_PROVIDER_CONNECTIONS_ONLY === 'true') {
  const { credentialsFromCatalog, providerApi } = await moduleAt('provider-direct.js');
  const authorization = `Bearer ${createHmac('sha256', process.env.HMAC_SECRET).update('koratv-account-admin-v1').digest('hex')}`;
  const status = await (await fetch('http://127.0.0.1:3100/internal/accounts-status', { headers: { authorization } })).json();
  let privateCredentials = {};
  try { privateCredentials = JSON.parse(readFileSync('/etc/koratv/provider-credentials.json', 'utf8')); } catch {}
  for (const provider of ['B', 'D']) {
    const state = status.accounts.find(row => row.provider === provider);
    if (state?.current_channel) { report('connectionProbe', { provider, skipped: 'busy_account' }); continue; }
    const account = catalog.accounts()[provider];
    const credentials = privateCredentials[provider] || credentialsFromCatalog(account);
    if (!credentials) { report('connectionProbe', { provider, error: 'credentials_missing' }); continue; }
    const identity = createHash('sha256').update(credentials.username + ':' + credentials.password).digest('hex').slice(0, 12);
    const origins = [...new Set([...(credentials.origins || []), ...(account?.origins || [])])];
    for (let index = 0; index < origins.length; index++) {
      try {
        const info = (await providerApi(credentials, origins[index])).user_info;
        report('providerConnectionMetadata', { provider, identity, originIndex: index, auth: info?.auth, status: info?.status, maxConnections: info?.max_connections, activeConnections: info?.active_cons });
      } catch (error) { report('providerConnectionMetadata', { provider, identity, originIndex: index, error: error.name, cause: error.cause?.code || null }); }
    }
    for (const channel of ['beIN SPORTS HD 1', 'beIN SPORTS HD 4']) {
      const source = catalog.sources(channel)[provider];
      if (!source) continue;
      let url = new URL(source);
      report('connectionTarget', { provider, channel, protocol: url.protocol, port: url.port || 'default', catalogOrigin: new URL(account.sourceUrl).origin === url.origin });
      for (let redirect = 0; redirect < 5; redirect++) {
        try {
          const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'IPTVSmartersPlayer', Accept: '*/*' }, signal: AbortSignal.timeout(10000) });
          const location = response.headers.get('location');
          if (response.status >= 300 && response.status < 400 && location) {
            const next = new URL(location, url);
            report('connectionRedirect', { provider, channel, redirect, status: response.status, originChanged: next.origin !== url.origin });
            await response.body?.cancel(); url = next; continue;
          }
          const reader = response.body?.getReader();
          const first = await reader?.read(); await reader?.cancel();
          report('connectionMedia', { provider, channel, status: response.status, bytes: first?.value?.length || 0, hls: Buffer.from(first?.value || []).toString('utf8').trimStart().startsWith('#EXTM3U') });
        } catch (error) {
          report('connectionMedia', { provider, channel, error: error.name, cause: error.cause?.code || null,
            badPort: error.cause?.message === 'bad port', causeName: error.cause?.name,
            nestedCodes: (error.cause?.errors || []).map(item => item.code).filter(Boolean), redirect, protocol: url.protocol, port: url.port || 'default' });
          try {
            const result = execFileSync('curl', ['-sS', '--max-time', '8', '--range', '0-1023', '-o', '/dev/null', '-w', '%{http_code}', '-A', 'IPTVSmartersPlayer', url.href], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            report('connectionCurl', { provider, channel, status: Number(result), exitCode: 0 });
          } catch (curlError) { report('connectionCurl', { provider, channel, status: Number(String(curlError.stdout || '').trim()) || 0, exitCode: curlError.status }); }
        }
        break;
      }
    }
  }
  process.exit(0);
}
if (process.env.DIAGNOSTICS_CHANNELS_ONLY === 'true') {
  report('exactChannelInventory', Object.entries(catalog.channels())
    .filter(([name]) => /arryadia|on\s*(?:time\s*)?sport/i.test(name))
    .map(([name, row]) => ({ name, providers: Object.keys(catalog.sources(name)), sourceNames: row.sourceNames || {} })));
  const { credentialsFromCatalog, discoverProvider } = await moduleAt('provider-direct.js');
  let privateCredentials = {};
  try { privateCredentials = JSON.parse(readFileSync('/etc/koratv/provider-credentials.json', 'utf8')); } catch {}
  const account = catalog.accounts().H;
  const input = privateCredentials.H || credentialsFromCatalog(account);
  const seen = new Set();
  if (input && account?.enabled) await discoverProvider(input, [...new Set([...(input.origins || []), ...(account.origins || [])])], ['beIN SPORTS HD 7'], {
    retry: 1, verifySource: async chosen => {
      if (!seen.has(chosen.source_name)) report('georgiaChannelVariant', { provider: 'H', name: chosen.source_name, group: chosen.group });
      seen.add(chosen.source_name);
      return false;
    }
  });
  process.exit(0);
}
const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
report('processes', apps.map(app => ({ name: app.name, ...pick(app.pm2_env, ['status', 'pm_cwd', 'pm_exec_path', 'restart_time']) })));
if (process.env.DIAGNOSTICS_RECONCILIATION_ONLY === 'true') {
  const before = catalog.assignments();
  await delay(70_000);
  catalog.refreshNow();
  const after = catalog.assignments();
  const beforeAt = Date.parse(before.generatedAt), afterAt = Date.parse(after.generatedAt);
  report('minuteReconciliation', {before:before.generatedAt, after:after.generatedAt,
    advanced:Number.isFinite(afterAt) && afterAt > beforeAt,
    assignments:after.assignments.map(row=>pick(row,['matchId','providerId','resolvedChannel']))});
  assert.ok(Number.isFinite(afterAt) && afterAt > beforeAt, 'Resource reconciliation did not advance during the 70-second observation');
  process.exit(0);
}
report('providers', Object.entries(catalog.accounts()).map(([id, row]) => ({ id, ...pick(row, ['enabled', 'syncStatus', 'status', 'maxConnections', 'gatewaySlots', 'updatedAt']) })));
const assignments = catalog.assignments();
report('assignments', { generatedAt: assignments.generatedAt, date: assignments.date,
  assignments: assignments.assignments.map(row => pick(row, ['matchId', 'providerId', 'resolvedChannel', 'requestedChannel', 'priorityScore', 'manual'])),
  ignored: assignments.ignored.map(row => pick(row, ['matchId', 'reason', 'resolvedChannel'])) });
const authorization = `Bearer ${createHmac('sha256', process.env.HMAC_SECRET).update('koratv-account-admin-v1').digest('hex')}`;
const accountsResponse = await fetch('http://127.0.0.1:3100/internal/accounts-status', { headers: { authorization }, signal: AbortSignal.timeout(6000) });
report('accountStatusHttp', accountsResponse.status);
if (accountsResponse.ok) {
  const data = await accountsResponse.json();
  report('accounts', data.accounts.map(row => pick(row, ['provider', 'status', 'current_channel', 'current_match', 'last_http_code', 'stopped_reason', 'last_checked_at', 'cooldown_until', 'consecutive_403', 'max_connections', 'active_cons', 'provider_status', 'gateway_slots'])));
}
try {
  const persisted = JSON.parse(readFileSync(process.env.ACCOUNTS_STATUS_PATH || '/etc/koratv/accounts-status.json', 'utf8'));
  report('persistedStatus', { updatedAt: persisted.updatedAt, accounts: (persisted.accounts || []).map(row => pick(row, ['provider', 'status', 'last_http_code', 'stopped_reason', 'last_checked_at', 'cooldown_until'])) });
} catch { report('persistedStatus', 'unreadable'); }
const matchesResponse = await fetch('http://127.0.0.1:3100/api/matches?day=today', { headers: { Origin: 'https://koratv.click' }, signal: AbortSignal.timeout(10000) });
const matchesData = await matchesResponse.json();
const matches = Array.isArray(matchesData) ? matchesData : (matchesData.matches || []);
const playback = createPlaybackResolver(process.env, ['kooora'], catalog);
for (const row of matches) {
  const matchId = row.matchId || row.match_id || row.stableId || row.id;
  report('match', { matchId, ...pick(row, ['homeTeam', 'awayTeam', 'score', 'status', 'liveMinute', 'scheduledAt', 'channelName', 'resourceAssignment', 'broadcastChannels', 'detailsUpdatedAt', 'sourceFixtureId', 'playbackState', 'playbackReady']) });
  if (row.playbackState === 'live' || row.playbackReady) {
    try {
      const result = await playback(matchId);
      report('preparedPlayback', { id: matchId, ...pick(result, ['is_streaming_active', 'reason', 'channel_id', 'pool_key']), providers: Object.keys(result?.provider_sources || {}) });
    } catch { report('preparedPlayback', { id: matchId, error: 'resolver_failed' }); }
  }
}
for (const channel of ['Arryadia TNT', 'beIN SPORTS HD 1']) {
  const sources = catalog.sources(channel);
  report('channelSources', { channel, providers: Object.keys(sources) });
  for (const [provider, url] of Object.entries(sources)) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': process.env.UPSTREAM_USER_AGENT || 'IPTVSmartersPlayer', Accept: '*/*' }, signal: AbortSignal.timeout(10000) });
      const reader = response.body?.getReader();
      const first = reader ? await reader.read() : { value: null };
      await reader?.cancel();
      report('mediaSample', { channel, provider, status: response.status, contentType: response.headers.get('content-type'), hls: Buffer.from(first.value || []).toString('utf8').trimStart().startsWith('#EXTM3U') });
    } catch { report('mediaSample', { channel, provider, error: 'request_failed' }); }
  }
}
const health = await fetch('http://127.0.0.1:3100/healthz', { signal: AbortSignal.timeout(6000) });
report('health', await health.json());
