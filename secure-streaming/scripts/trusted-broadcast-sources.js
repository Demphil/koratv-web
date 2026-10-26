import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { sameFixture, preferredBroadcastChannels } from '../../shared/match-broadcasts.mjs';

export const BEIN_GUIDE_URL = 'https://www.beinsports.com/ar-mena/%D8%AC%D8%AF%D9%88%D9%84-%D8%A7%D9%84%D8%A8%D8%AB';
const API = 'https://www.beinsports.com/api/opta';
const CACHE_MS = 5 * 60_000;
const CACHE_VERSION = 3;
const pending = new Map();
const memory = new Map();
const isBein = name => /\bbein\b/i.test(String(name || ''));

export function officialBeinChannel(name) {
  const value = String(name || '').replace(/\s+/g, ' ').trim();
  if (!/^beIN SPORTS\b/i.test(value)) return '';
  const number = value.match(/\b(\d{1,2})\b/)?.[1];
  if (!number) return '';
  const family = value.match(/\b(AFC|MAX|XTRA|PREMIUM|CONNECT)\b/i)?.[1]?.toUpperCase();
  const language = value.match(/\b(EN|ENG|FR)\b/i)?.[1]?.toUpperCase();
  if (family) return `beIN SPORTS ${family} ${number}`;
  if (language) return `beIN SPORTS ${language === 'FR' ? 'FRANCE' : 'ENG'} ${number}`;
  return `beIN SPORTS HD ${number}`;
}

function teamName(value) {
  return String(value || '').normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:A\.\s*Ş\.|Fk)\s*$/iu, '')
    .replace(/^(?:PFC|FC|SC)\s+/i, '')
    .replace(/\s+(?:FC|SC|CF|Club)\s*$/i, '').trim();
}

export function parseBeinGuide(channels, response) {
  if (!Array.isArray(channels?.rows) || !Array.isArray(response?.rows)
    || Number(response.count) > response.rows.length) throw new Error('invalid_bein_guide');
  const names = new Map(channels.rows.map(channel => [channel.id, officialBeinChannel(channel.name)]));
  return response.rows.flatMap(event => {
    const channel = names.get(event.channelId);
    const start = Date.parse(event.startDate), end = Date.parse(event.endDate);
    const sport = event.sportType?.name;
    // beIN classifies some AFC football fixtures as Other / Sports General.
    const football = sport === 'Football' || (sport === 'Other'
      && /AFC Champions League|UEFA Champions League|LaLiga|Ligue 1|Bundesliga|Serie A|Premier League|FIFA World Cup/i.test(event.title || ''));
    if (!channel || !football || event.live !== true || event.replay === true || !Number.isFinite(start)
      || !Number.isFinite(end) || end <= start || end - start > 6 * 60 * 60_000) return [];
    const sides = String(event.title || '').split(/\s+vs\.?\s+/i);
    const home = teamName(event.data?.teama || sides[0]);
    const away = teamName(event.data?.teamb || sides[1]?.split(/\s+[–—-]\s+/)[0]);
    if (sides.length !== 2 || !home || !away) return [];
    return [{ id: String(event.id), channel, home_team: home, away_team: away,
      league: `${event.category || ''} ${event.title || ''}`, title: String(event.title), start: event.startDate, end: event.endDate }];
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`bein_guide_http_${response.status}`);
  return response.json();
}

export async function loadBeinGuide(day, { request = fetchJson, now = Date.now(),
  cacheFile = process.env.BEIN_GUIDE_CACHE_FILE || join(tmpdir(), 'koratv-bein-guide-cache.json') } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('invalid_bein_day');
  const key = `${cacheFile}:${day}`;
  const fresh = entry => entry?.version === CACHE_VERSION && Array.isArray(entry.events)
    && now >= entry.checkedAt && now - entry.checkedAt < CACHE_MS;
  if (fresh(memory.get(key))) return memory.get(key);
  if (pending.has(key)) return pending.get(key);
  const operation = (async () => {
    let disk = {};
    try { disk = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {}
    if (fresh(disk[day])) { memory.set(key, disk[day]); return disk[day]; }
    let events;
    try {
      const channels = await request(`${API}/tv-channel?region=ar-mena`);
      if (!Array.isArray(channels?.rows) || !channels.rows.length) throw new Error('invalid_bein_channels');
      const start = Date.parse(`${day}T00:00:00Z`);
      const params = new URLSearchParams({ startBefore: new Date(start + 24 * 60 * 60_000).toISOString(),
        endAfter: new Date(start - 3 * 60 * 60_000).toISOString(), limit: '3000' });
      for (const channel of channels.rows) if (officialBeinChannel(channel.name)) params.append('channelIds', channel.id);
      events = parseBeinGuide(channels, await request(`${API}/tv-event?${params}`));
    } catch (error) {
      const previous = disk[day];
      if (previous?.version === CACHE_VERSION && Array.isArray(previous.events) && now >= previous.checkedAt
        && now - previous.checkedAt < 30 * 60_000) return { ...previous, stale: true };
      throw error;
    }
    const entry = { version: CACHE_VERSION, checkedAt: now, events };
    memory.set(key, entry);
    if (memory.size > 8) memory.delete(memory.keys().next().value);
    const saved = Object.fromEntries(Object.entries({ ...disk, [day]: entry })
      .filter(([, value]) => value?.checkedAt >= now - 48 * 60 * 60_000)
      .sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 4));
    try {
      await mkdir(dirname(cacheFile), { recursive: true });
      const temporary = `${cacheFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
      await rename(temporary, cacheFile);
    } catch (error) { console.warn(`beIN guide cache write skipped: ${error.code || 'write_failed'}`); }
    return entry;
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}

export function resolveBeinBroadcast(row, events) {
  const kickoff = Date.parse(row.kickoff_time);
  if (!Number.isFinite(kickoff)) return [];
  return events.filter(event => {
    const start = Date.parse(event.start), end = Date.parse(event.end);
    // Coverage can begin before kickoff; a replay or an adjacent programme is not confirmation.
    if (kickoff < start - 10 * 60_000 || kickoff > start + 120 * 60_000 || kickoff > end - 15 * 60_000) return false;
    return sameFixture(row, { ...event, kickoff_time: row.kickoff_time });
  });
}

export async function applyTrustedBroadcastChannels(_supabase, rows, { loadGuide = loadBeinGuide, now = Date.now() } = {}) {
  const guides = new Map();
  let updated = 0;
  const output = [];
  for (const row of rows) {
    const snapshot = row.payload?.broadcast;
    const original = snapshot?.koooraChannels || snapshot?.channels || row.payload?.channels || [];
    if (snapshot?.source !== 'kooora' || !original.some(isBein)) { output.push(row); continue; }
    const day = String(row.kickoff_time).slice(0, 10);
    if (!guides.has(day)) {
      try { guides.set(day, await loadGuide(day)); }
      catch (error) { console.warn(`beIN guide unavailable for ${day}: ${error.message}`); guides.set(day, null); }
    }
    const guide = guides.get(day);
    const programs = guide ? resolveBeinBroadcast(row, guide.events) : [];
    const confirmed = preferredBroadcastChannels(programs.map(event => event.channel));
    const verification = { source: 'bein-official-tv-guide', sourceUrl: BEIN_GUIDE_URL,
      state: confirmed.length ? 'confirmed' : guide ? 'not_found' : 'unavailable',
      stale: guide?.stale === true,
      checkedAt: new Date(now).toISOString(), guideCheckedAt: guide ? new Date(guide.checkedAt).toISOString() : null,
      channels: confirmed, programs: programs.map(({ id, channel, title, start, end }) => ({ id, channel, title, start, end })) };
    const channels = confirmed.length ? preferredBroadcastChannels([...confirmed, ...original.filter(name => !isBein(name))]) : original;
    const channel = channels[0] || row.channel;
    if (confirmed.length && channel !== row.channel) updated += 1;
    output.push({ ...row, channel, payload: { ...row.payload, channel, channels, sourceChannels: channels,
      broadcast: { ...snapshot, channels, koooraChannels: original, beinVerification: verification },
      channelResolvedBy: confirmed.length ? verification.source : row.payload.channelResolvedBy,
      channelSourceUrl: confirmed.length ? BEIN_GUIDE_URL : null,
      channelNotes: confirmed.length ? 'Confirmed against the official beIN live programme, teams and kickoff window.'
        : 'Official beIN confirmation unavailable; existing assignment retained without guessing.' } });
  }
  return { rows: output, updated };
}
