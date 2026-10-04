import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const report = (name, data) => console.log(JSON.stringify({ name, data }));
const moduleAt = name => import(pathToFileURL(resolve(process.cwd(), name)).href);
const { createProviderCatalog } = await moduleAt('provider-catalog.js');
const { createPlaybackResolver } = await moduleAt('supabase.js');
const catalog = createProviderCatalog(process.env);
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
