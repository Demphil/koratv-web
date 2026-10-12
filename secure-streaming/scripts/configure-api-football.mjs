import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';

const config = JSON.parse(await new Promise(resolve => {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => resolve(input));
}));
if (typeof config.key !== 'string' || !config.key.trim() || /[\r\n]/.test(config.key)) throw new Error('Invalid API key');
const path = process.argv[2];
if (!path) throw new Error('Environment file required');
const response = await fetch('https://v3.football.api-sports.io/status', {
  headers: { 'x-apisports-key': config.key }, signal: AbortSignal.timeout(15000),
});
const body = await response.json();
const dailyLimit = Number(body.response?.requests?.limit_day);
if (!response.ok || Object.keys(body.errors || {}).length || !Number.isSafeInteger(dailyLimit) || dailyLimit <= 0) {
  throw new Error(`API-Football configuration rejected (${response.status})`);
}
const values = {
  API_FOOTBALL_KEY: config.key.trim(), MATCH_SOURCE_PROVIDER: 'both',
  API_FOOTBALL_CACHE_DIR: '/home/ubuntu/iptv-system/.api-football-cache',
  API_FOOTBALL_QUOTA_RESERVE: String(Math.min(100, Math.floor(dailyLimit * 0.02))),
  API_FOOTBALL_DAILY_BUDGET: String(Math.min(2000, Math.floor(dailyLimit * 0.7))),
  API_FOOTBALL_LIVE_DETAILS_REFRESH_MINUTES: '2',
  API_FOOTBALL_LINEUP_DETAILS_REFRESH_MINUTES: '15',
};
const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(line => !Object.keys(values).some(key => line.startsWith(key + '=')));
writeFileSync(path, lines.concat(Object.entries(values).map(([key, value]) => `${key}=${value}`)).join('\n'), { mode: 0o600 });
chmodSync(path, 0o600);
mkdirSync(values.API_FOOTBALL_CACHE_DIR, { recursive: true, mode: 0o700 });
console.log(JSON.stringify({ http: response.status, errors: body.errors,
  plan: body.response?.subscription?.plan, requests: body.response?.requests }));
