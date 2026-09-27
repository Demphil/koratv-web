import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../config.js';
import { broadcastChannelCandidates } from '../../shared/match-broadcasts.mjs';
import { findChannelNameMatch } from '../../shared/channel-name-match.mjs';
import { isAllowedMatch } from '../../shared/league-whitelist.mjs';

const config = loadConfig();
const apply = process.argv.includes('--apply');
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

function account(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length === 4 && parts[0] === 'live' ? parts.slice(1, 3).join('/') : null;
  } catch { return null; }
}

async function probe(url) {
  let manifestUrl = url;
  try {
    for (let depth = 0; depth < 3; depth += 1) {
      const response = await fetch(manifestUrl, { headers: { 'User-Agent': config.upstreamUserAgent }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) { await response.body?.cancel(); return { ok: false, status: response.status }; }
      const manifest = await response.text();
      if (!manifest.trimStart().startsWith('#EXTM3U')) return { ok: false, reason: 'not_hls' };
      const uri = manifest.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'));
      if (!uri) return { ok: false, reason: 'empty_hls' };
      const target = new URL(uri.trim(), response.url || manifestUrl);
      if (manifest.includes('#EXT-X-STREAM-INF:')) { manifestUrl = target.href; continue; }
      const segment = await fetch(target, { headers: { 'User-Agent': config.upstreamUserAgent }, signal: AbortSignal.timeout(8000) });
      const reader = segment.body?.getReader();
      const first = reader ? await reader.read() : null;
      await reader?.cancel();
      const bytes = first?.value || new Uint8Array();
      const type = segment.headers.get('content-type') || '';
      const text = new TextDecoder().decode(bytes.slice(0, 80)).trimStart();
      return { ok: segment.ok && bytes.length >= 188 && !/text\/html|application\/json/.test(type) && !text.startsWith('<'),
        status: segment.status, segmentBytesRead: bytes.length };
    }
    return { ok: false, reason: 'nested_hls_limit' };
  } catch (error) { return { ok: false, reason: error.name === 'TimeoutError' ? 'timeout' : 'network' }; }
}

async function hasPlaybackCapacity(source) {
  try {
    const credentials = account(source)?.split('/');
    if (!credentials) return false;
    const endpoint = new URL('/player_api.php', source);
    endpoint.searchParams.set('username', decodeURIComponent(credentials[0]));
    endpoint.searchParams.set('password', decodeURIComponent(credentials[1]));
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    const info = (await response.json()).user_info;
    if (!response.ok || Number(info?.auth) !== 1) return false;
    const active = Number(info.active_cons), max = Number(info.max_connections);
    return Number.isFinite(active) && Number.isFinite(max) && (max === 0 || active < max);
  } catch { return false; }
}

const { data: channels, error: channelError } = await client.from('channels').select('id,name,active,original_url,quality_variants');
if (channelError) throw new Error(`Channel lookup failed (${channelError.code})`);
const { data: matches, error: matchError } = await client.from(process.env.SUPABASE_MATCHES_TABLE || 'matches')
  .select('source,home_team,away_team,league,channel,payload').eq('active', true)
  .gte('kickoff_time', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
  .lte('kickoff_time', new Date(Date.now() + 48 * 60 * 60_000).toISOString());
if (matchError) throw new Error(`Fixture lookup failed (${matchError.code})`);
const required = new Set();
for (const row of matches || []) {
  if (!isAllowedMatch({ league: row.league, leagueCountry: row.payload?.leagueCountry, homeTeam: row.home_team, awayTeam: row.away_team })) continue;
  if (row.payload?.broadcast?.source !== 'kooora' && !String(row.source).startsWith('kooora')) continue;
  for (const name of broadcastChannelCandidates(row)) {
    const matched = findChannelNameMatch(name, channels.map((item) => item.name));
    if (matched) required.add(matched);
  }
}

for (const channel of channels.filter((item) => required.has(item.name) && item.original_url)) {
  if (!(await hasPlaybackCapacity(channel.original_url))) {
    console.log(JSON.stringify({ channel: channel.name, skipped: 'account_busy_or_capacity_unknown' }));
    continue;
  }
  const candidates = new Set([channel.original_url]);
  const identity = account(channel.original_url);
  // Provider hostname rotations retain the same Xtream account and stream ID.
  // Only try origins already used by an active channel on that exact account.
  for (const peer of channels.filter((item) => item.active && identity && account(item.original_url) === identity)) {
    const candidate = new URL(channel.original_url);
    const origin = new URL(peer.original_url);
    candidate.protocol = origin.protocol;
    candidate.host = origin.host;
    candidates.add(candidate.href);
  }
  for (const url of candidates) {
    const result = await probe(url);
    console.log(JSON.stringify({ channel: channel.name, originChanged: url !== channel.original_url, ...result }));
    if (!result.ok) continue;
    if (apply && (!channel.active || url !== channel.original_url)) {
      const update = { active: true, original_url: url };
      if (url !== channel.original_url) update.quality_variants = [];
      const { data, error } = await client.from('channels').update(update)
        .eq('id', channel.id).eq('original_url', channel.original_url).select('id');
      if (error) throw new Error(`Channel recovery failed (${error.code})`);
      console.log(JSON.stringify({ channel: channel.name, restored: data.length === 1 }));
    }
    break;
  }
}
