import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const settings = { ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
const base = settings.SUPABASE_URL || settings.NEXT_PUBLIC_SUPABASE_URL;
const key = settings.SUPABASE_SECRET_KEY || settings.SUPABASE_SERVICE_ROLE_KEY || settings.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!base || !key) throw new Error('Supabase URL and server-capable key are required');
if (!settings.TEST_STREAM_URL) throw new Error('Set TEST_STREAM_URL to a real HLS playlist before seeding playback.');

const source = new URL(settings.TEST_STREAM_URL);
if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) {
  throw new Error('Use an HTTP(S) source without embedded credentials');
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

async function upsert(table, record, conflict) {
  const url = new URL(`/rest/v1/${table}`, base);
  url.searchParams.set('on_conflict', conflict);
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    console.error(`${table}: HTTP ${response.status}, code ${result.code || 'unknown'}`);
    if ([401, 403].includes(response.status)) {
      console.error('Current key cannot write. Use SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY; do not disable RLS.');
    }
    process.exitCode = 1;
    return false;
  }
  console.log(`${table}: upsert succeeded`);
  return true;
}

const channelName = settings.TEST_CHANNEL_NAME || 'beIN SPORTS HD 1';
const matchId = settings.TEST_MATCH_ID || 'match-01';
const kickoff = new Date(Date.now() + 5 * 60_000).toISOString();

await upsert('channels', {
  name: channelName,
  original_url: source.href,
  active: true,
}, 'name');

await upsert('matches', {
  id: matchId,
  match_id: matchId,
  home_team: settings.TEST_HOME_TEAM || 'Test Home',
  away_team: settings.TEST_AWAY_TEAM || 'Test Away',
  league: settings.TEST_LEAGUE || 'الدوري الإسباني',
  kickoff_time: settings.TEST_KICKOFF_TIME || kickoff,
  channel: channelName,
  source: 'manual-seed',
  active: true,
  payload: {
    homeTeam: { name: settings.TEST_HOME_TEAM || 'Test Home', logo: '' },
    awayTeam: { name: settings.TEST_AWAY_TEAM || 'Test Away', logo: '' },
    scheduledAt: settings.TEST_KICKOFF_TIME || kickoff,
    status: 'FIXTURE',
    channel: channelName,
    score: 'VS',
  },
}, 'match_id');
