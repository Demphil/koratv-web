import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApiFootballClient } from '../secure-streaming/scripts/api-football-client.mjs';
import { SELECTED_BROADCAST_IDS } from '../shared/broadcast-selection.mjs';
import { publicMatchId } from '../shared/public-match-id.mjs';
import { sameFixture, teamIdentity } from '../shared/match-broadcasts.mjs';
import { sourceMatchState } from '../shared/match-lifecycle.mjs';
import { createAppCacheClient } from './player-app-cache.mjs';

const MINUTE = 60000;
const aliases = new Map([
  ['بريست', ['Brest', 'Stade Brestois 29']], ['باريس', ['Paris FC']],
  ['فينيسيا', ['Venezia']], ['بولونيا', ['Bologna']],
  ['ليفانتي', ['Levante']], ['راسينج سانتاندير', ['Racing Santander', 'Racing']],
  ['نوتنجهام فوريست', ['Nottingham Forest']], ['تشيلسي', ['Chelsea']]
]);
const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const number = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const imageHosts = new Set(['cdn.sportfeeds.io', 'media.api-sports.io', 'media-1.api-sports.io', 'media-2.api-sports.io', 'media-3.api-sports.io']);
export function safeImage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && imageHosts.has(url.hostname)
    && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

function names(row, side) {
  return [row[`${side}_team`], row.payload?.[`${side}TeamEnglish`],
    ...(row.payload?.[`${side}TeamEnglishAliases`] || []), ...(aliases.get(row[`${side}_team`]) || [])]
    .filter(name => typeof name === 'string').map(name => teamIdentity(name, row));
}

export function resolveFixture(row, fixtures) {
  const enriched = { ...row, payload: { ...row.payload,
    homeTeamEnglishAliases: aliases.get(row.home_team) || [], awayTeamEnglishAliases: aliases.get(row.away_team) || [] } };
  const matches = fixtures.filter(item => Number.isSafeInteger(item?.fixture?.id) && item.fixture.id > 0 && sameFixture(enriched, {
    home_team: item.teams?.home?.name, away_team: item.teams?.away?.name,
    kickoff_time: item.fixture.date, league: item.league?.name, payload: {}
  }));
  if (matches.length !== 1) return null;
  return { fixture: matches[0], reverse: !names(row, 'home').includes(teamIdentity(matches[0].teams.home.name, row)) };
}

function baseMatch(row, generatedAt, now) {
  const p = row.payload || {}, state = sourceMatchState(p);
  return {
    matchId: row.match_id, publicMatchId: publicMatchId(row.match_id),
    homeTeam: text(row.home_team), awayTeam: text(row.away_team), league: text(row.league),
    scheduledAt: row.kickoff_time, homeLogo: safeImage(p.homeLogo), awayLogo: safeImage(p.awayLogo),
    score: /^\d+\s*-\s*\d+$/.test(p.score || '') ? p.score : 'VS',
    playbackState: state, liveMinute: number(p.liveMinute), liveExtraMinute: number(p.liveExtraMinute) || 0,
    channelName: text(row.channel || p.channel), dataSource: 'kooora', detailsState: 'pending',
    scheduleUpdatedAt: new Date(generatedAt).toISOString(), snapshotStale: now - generatedAt > 30 * MINUTE,
    statistics: [], events: [], goals: [], lineups: [], players: [],
    detailStates: { lineups: 'pending' }, eventDetailsLoaded: false
  };
}

export function mergeFixture(base, entry, now) {
  const f = entry.fixture, side = key => f.teams[entry.reverse ? key === 'home' ? 'away' : 'home' : key];
  const state = sourceMatchState({ status: f.fixture.status?.short });
  const sharedCache = entry.sourceMode === 'app-cache-only';
  const fresh = entry.final || now - entry.checkedAt <= 20 * MINUTE;
  const regresses = base.playbackState === 'ended' && state !== 'ended'
    || base.playbackState === 'live' && state === 'upcoming';
  const home = side('home'), away = side('away');
  const teamName = id => id === home.id ? base.homeTeam : id === away.id ? base.awayTeam : '';
  const statistics = [home, away].map(team => {
    const group = (f.statistics || []).find(item => item.team?.id === team.id);
    return { team: teamName(team.id), statistics: (group?.statistics || []).slice(0, 40)
      .map(item => ({ type: text(item.type), value: typeof item.value === 'number' ? item.value : item.value == null ? null : text(item.value, 40) })) };
  });
  const events = (f.events || []).slice(0, 100).map(event => ({
    type: text(event.type, 32), detail: text(event.detail), player: text(event.player?.name), assist: text(event.assist?.name),
    team: teamName(event.team?.id), elapsed: number(event.time?.elapsed), extra: number(event.time?.extra)
  }));
  const player = item => ({ name: text(item.player?.name), number: number(item.player?.number),
    grid: text(item.player?.grid, 12), photo: '' });
  const lineups = (f.lineups || []).slice(0, 2).map(item => ({
    teamId: number(item.team?.id), team: teamName(item.team?.id), formation: text(item.formation, 32),
    coach: text(item.coach?.name), coachPhoto: safeImage(item.coach?.photo),
    startXI: (item.startXI || []).slice(0, 11).map(player), substitutes: (item.substitutes || []).slice(0, 25).map(player)
  }));
  const cardCount = type => Object.fromEntries(['home', 'away'].map((key, index) => [key,
    number(statistics[index].statistics.find(item => item.type === type)?.value)]));
  const scoreHome = f.goals?.[entry.reverse ? 'away' : 'home'], scoreAway = f.goals?.[entry.reverse ? 'home' : 'away'];
  return {
    ...base, dataSource: 'api-football', sourceFixtureId: f.fixture.id,
    homeTeamId: home.id, awayTeamId: away.id, homeTeamEnglish: text(home.name), awayTeamEnglish: text(away.name),
    homeLogo: safeImage(home.logo) || base.homeLogo, awayLogo: safeImage(away.logo) || base.awayLogo,
    ...(fresh && !regresses && !sharedCache ? { playbackState: state, liveMinute: number(f.fixture.status?.elapsed),
      liveExtraMinute: number(f.fixture.status?.extra) || 0,
      score: number(scoreHome) != null && number(scoreAway) != null ? `${scoreHome} - ${scoreAway}` : 'VS' } : {}),
    referee: text(f.fixture.referee), venue: text(f.fixture.venue?.name), venueCity: text(f.fixture.venue?.city),
    statistics: statistics.some(group => group.statistics.length) ? statistics : [], events,
    goals: events.filter(event => event.type === 'Goal' && !/missed|cancelled/i.test(event.detail))
      .map(event => ({ ...event, minute: event.elapsed })), lineups,
    yellowCards: cardCount('Yellow Cards'), redCards: cardCount('Red Cards'),
    eventDetailsLoaded: Array.isArray(f.events), detailsState: fresh ? 'ready' : 'stale',
    detailStates: { lineups: lineups.some(item => item.startXI.length) ? 'ready' : 'pending' },
    detailsUpdatedAt: new Date(entry.checkedAt).toISOString(), detailsStale: !fresh || sharedCache,
    sourceMode: entry.sourceMode || 'direct'
  };
}

export async function refreshMatchData({ snapshot, state = {}, client = null, now = Date.now(), selectedIds = SELECTED_BROADCAST_IDS }) {
  const generatedAt = Date.parse(snapshot?.generatedAt);
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.matches) || snapshot.matches.length > 5000
    || !Number.isFinite(generatedAt) || generatedAt > now + 5 * MINUTE || now - generatedAt > 48 * 60 * MINUTE) {
    throw new Error('Invalid or expired local schedule');
  }
  const selected = new Set(selectedIds.slice(0, 20));
  const currentRows = snapshot.matches.filter(row => row.source === 'kooora' && selected.has(row.match_id)
    && row.home_team && row.away_team && Number.isFinite(Date.parse(row.kickoff_time)));
  state = { entries: state.entries || {}, discovery: state.discovery || {}, failures: state.failures || {}, selectedRows: state.selectedRows || {} };
  for (const row of currentRows) state.selectedRows[row.match_id] = { ...row, scheduleSnapshotAt: snapshot.generatedAt };
  state.selectedRows = Object.fromEntries(Object.entries(state.selectedRows).filter(([id, row]) => selected.has(id)
    && Number.isFinite(Date.parse(row.kickoff_time)) && Math.abs(now - Date.parse(row.kickoff_time)) <= 48 * 60 * MINUTE));
  const rows = Object.values(state.selectedRows);
  const output = {}, diagnostics = { selected: rows.length, apiConfigured: Boolean(client), matched: 0, errors: 0 };
  for (const row of rows) {
    const id = row.match_id, kickoff = Date.parse(row.kickoff_time), day = new Date(kickoff).toISOString().slice(0, 10);
    const contextAt = Date.parse(row.scheduleSnapshotAt) || generatedAt;
    let entry = state.entries[id];
    const inWindow = now >= kickoff - 6 * 60 * MINUTE && now <= kickoff + 24 * 60 * MINUTE;
    const failureExpired = !(state.failures[id] > now);
    const shared = client?.mode === 'app-cache-only';
    const incompleteFinal = shared && entry?.final && now - kickoff <= 6 * 60 * MINUTE
      && ['statistics', 'lineups', 'events'].some(field => !Array.isArray(entry.fixture[field]))
      && now - entry.checkedAt >= 30 * MINUTE;
    const wantsDetails = incompleteFinal || now >= kickoff - 30 * MINUTE && (!entry?.final || !entry?.detailed)
      && (!entry?.detailed || now >= kickoff && now - entry.checkedAt >= 10 * MINUTE);
    if (client && (client.mode === 'app-cache-only' || now - contextAt <= 30 * MINUTE) && inWindow && failureExpired && (!entry || wantsDetails)) {
      try {
        let found = entry && { fixture: entry.fixture, reverse: entry.reverse };
        if (!found) {
          let discovery = state.discovery[day];
          const discoveryTtl = shared ? 10 * MINUTE : 6 * 60 * MINUTE;
          if (!discovery || now - discovery.checkedAt >= discoveryTtl) {
            const fixtures = await client.request('/fixtures', { date: day, timezone: 'UTC' }, { ttlMs: discoveryTtl });
            discovery = state.discovery[day] = { checkedAt: now, fixtures };
          }
          found = resolveFixture(row, discovery.fixtures);
        }
        if (found && wantsDetails) {
          const detail = await client.request('/fixtures', { id: found.fixture.fixture.id }, { ttlMs: 10 * MINUTE });
          const verified = resolveFixture(row, detail);
          if (!verified || verified.fixture.fixture.id !== found.fixture.fixture.id) throw new Error('Fixture identity changed');
          found = verified;
        }
        if (found) {
          entry = state.entries[id] = { ...found, checkedAt: now, detailed: wantsDetails, sourceMode: client.mode || 'direct',
            final: wantsDetails && sourceMatchState({ status: found.fixture.fixture.status?.short }) === 'ended' };
        }
      } catch {
        diagnostics.errors++; state.failures[id] = now + 15 * MINUTE;
      }
    }
    const base = baseMatch(row, contextAt, now);
    if (entry) diagnostics.matched++;
    output[base.publicMatchId] = entry ? mergeFixture(base, entry, now) : { ...base, detailsState: client ? 'unmatched_fixture' : 'not_configured' };
  }
  state.entries = Object.fromEntries(Object.entries(state.entries).filter(([id]) => selected.has(id)));
  state.failures = Object.fromEntries(Object.entries(state.failures).filter(([id]) => selected.has(id)));
  state.discovery = Object.fromEntries(Object.entries(state.discovery).filter(([, value]) => now - value.checkedAt < 48 * 60 * MINUTE));
  return { state, diagnostics, publicData: { version: 1, generatedAt: new Date(now).toISOString(),
    scheduleGeneratedAt: snapshot.generatedAt, refreshAfterSeconds: 120, matches: output } };
}

async function readJson(filename, maxBytes = 4 * 1024 * 1024) {
  const data = await readFile(filename);
  if (data.byteLength > maxBytes) throw new Error('Local JSON size limit exceeded');
  return JSON.parse(data.toString('utf8'));
}
async function atomicJson(filename, data, mode) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data), { mode });
  await rename(temporary, filename);
}

async function main() {
  const env = process.env, directory = env.PLAYER_MATCH_DATA_DIR || '/var/lib/koratv-match-data';
  const key = env.API_FOOTBALL_KEY || '';
  const client = env.PLAYER_MATCH_APP_ORIGIN ? createAppCacheClient({ origin: env.PLAYER_MATCH_APP_ORIGIN,
    publicKey: env.PLAYER_MATCH_APP_PUBLIC_KEY, cacheDir: join(directory, 'shared-app-cache') })
    : key ? createApiFootballClient({ key, baseUrl: 'https://v3.football.api-sports.io',
    cacheDir: join(directory, 'api-cache'), dailyBudget: Math.min(60, Math.max(1, Number(env.PLAYER_API_DAILY_BUDGET || 60))),
    quotaReserve: Math.max(20, Number(env.PLAYER_API_QUOTA_RESERVE || 20)),
    minIntervalMs: 6500, timeoutMs: 8000, retries: 0 }) : null;
  let state;
  try { state = await readJson(join(directory, 'state.json'), 16 * 1024 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await refreshMatchData({ snapshot: await readJson(env.PLAYER_MATCH_SCHEDULE || '/var/lib/koratv-public/matches.json'), state, client });
  await atomicJson(join(directory, 'state.json'), result.state, 0o600);
  await atomicJson(env.PLAYER_MATCH_OUTPUT || '/var/lib/koratv-public/match-details.json', result.publicData, 0o644);
  console.log(JSON.stringify({ event: 'player_match_data_refreshed', ...result.diagnostics, quota: client?.quota() || null }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error(JSON.stringify({ event: 'player_match_data_failed' })); process.exitCode = 1; });
}
