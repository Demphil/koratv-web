import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const report = (name, data) => console.log(JSON.stringify({ name, data }));
const moduleAt = name => import(pathToFileURL(resolve(process.cwd(), name)).href);
const { createProviderCatalog } = await moduleAt('provider-catalog.js');
const { createPlaybackResolver } = await moduleAt('supabase.js');
const catalog = createProviderCatalog(process.env);
const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
report('processes', apps.map(app => ({ name: app.name, ...pick(app.pm2_env, ['status', 'pm_cwd', 'pm_exec_path', 'restart_time']) })));
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
  report('match', pick(row, ['id', 'homeTeam', 'awayTeam', 'score', 'status', 'liveMinute', 'scheduledAt', 'channelName', 'resourceAssignment', 'broadcastChannels', 'detailsUpdatedAt', 'sourceFixtureId', 'playbackState', 'playbackReady']));
  if (row.playbackState === 'live' || row.playbackReady) {
    try {
      const result = await playback(row.id);
      report('preparedPlayback', { id: row.id, ...pick(result, ['is_streaming_active', 'reason', 'channel_id', 'pool_key']), providers: Object.keys(result?.provider_sources || {}) });
    } catch { report('preparedPlayback', { id: row.id, error: 'resolver_failed' }); }
  }
}
const health = await fetch('http://127.0.0.1:3100/healthz', { signal: AbortSignal.timeout(6000) });
report('health', await health.json());
