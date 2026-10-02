import { normalizeTeamName } from './league-whitelist.mjs';

const normalize = (name) => normalizeTeamName(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const identities = new Map();
function register(id, names) {
  for (const name of names) if (name) identities.set(normalize(name), id);
}

// CLDR provides exact bilingual country names; never use fuzzy opponent matching.
const en = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const ar = new Intl.DisplayNames(['ar'], { type: 'region', fallback: 'none' });
for (let a = 65; a <= 90; a += 1) {
  for (let b = 65; b <= 90; b += 1) {
    const code = String.fromCharCode(a, b);
    if (en.of(code) && ar.of(code)) register(`country:${code}`, [en.of(code), ar.of(code)]);
  }
}
const aliases = [
  ['England', 'إنجلترا', 'انكلترا'], ['Scotland', 'اسكتلندا'], ['Wales', 'ويلز'],
  ['Denmark', 'الدنمارك', 'الدانمرك'],
  ['Northern Ireland', 'أيرلندا الشمالية', 'إيرلندا الشمالية'], ['Ireland', 'Republic of Ireland', 'Rep. Ireland', 'Rep. Of Ireland', 'أيرلندا', 'ايرلندا'],
  ['Israel', 'إسرائيل', 'الكيان العبري'],
  ['Bosnia & Herzegovina', 'Bosnia and Herzegovina', 'البوسنة والهرسك'],
  ['Central African Republic', 'أفريقيا الوسطى', 'جمهورية أفريقيا الوسطى'],
  ['Czechia', 'Czech Republic', 'التشيك', 'تشيكيا'], ['Türkiye', 'Turkey', 'تركيا'],
  ['North Macedonia', 'FYR Macedonia', 'مقدونيا الشمالية'], ['Lithuania', 'ليتوانيا', 'لتوانيا'],
  ['St. Vincent / Grenadines', 'St Vincent / Grenadines', 'Saint Vincent and the Grenadines', 'St. Vincent and the Grenadines'],
  ['Azerbaijan', 'أذربيجان', 'اذربيجان'], ['South Korea', 'Korea Republic', 'كوريا الجنوبية'],
  ['USA', 'United States', 'الولايات المتحدة الأمريكية', 'أمريكا'],
  ['Ivory Coast', "Cote D'Ivoire", 'ساحل العاج'], ['DR Congo', 'Congo DR', 'الكونغو الديمقراطية'],
  ['Real Madrid', 'ريال مدريد'], ['Barcelona', 'برشلونة'], ['Atletico Madrid', 'أتلتيكو مدريد'],
  ['Manchester City', 'مانشستر سيتي'], ['Manchester United', 'مانشستر يونايتد'],
  ['Liverpool', 'ليفربول'], ['Arsenal', 'آرسنال', 'أرسنال'], ['Chelsea', 'تشيلسي'],
  ['Tottenham', 'Tottenham Hotspur', 'توتنهام هوتسبير'], ['Newcastle', 'Newcastle United', 'نيوكاسل يونايتد'],
  ['Paris Saint Germain', 'Paris Saint-Germain', 'باريس سان جيرمان'],
  ['Bayern München', 'Bayern Munich', 'بايرن ميونخ'], ['Borussia Dortmund', 'بوروسيا دورتموند'],
  ['Inter', 'Inter Milan', 'إنتر ميلان'], ['AC Milan', 'ميلان'], ['Juventus', 'يوفنتوس'],
  ['Napoli', 'نابولي'], ['AS Roma', 'روما'], ['Wydad AC', 'Wydad Casablanca', 'الوداد الرياضي'],
  ['Widad Témara', 'Wydad Temara', 'وداد تمارة'], ['Raja Casablanca', 'Raja Club Athletic', 'الرجاء الرياضي'],
  ['FAR Rabat', 'AS FAR', 'الجيش الملكي'], ['FUS Rabat', 'الفتح الرباطي'],
  ['Renaissance Berkane', 'RSB Berkane', 'نهضة بركان'], ['Al Ahly', 'الأهلي'], ['Zamalek SC', 'Zamalek', 'الزمالك'],
  ['Moghreb Tetouan', 'المغرب التطواني'], ['Maghreb Fès', 'Maghreb Fes', 'المغرب الفاسي'],
  ['CR Khemis Zemamra', 'نهضة الزمامرة'], ['Kawkab Marrakech', 'الكوكب الرياضي المراكشي'],
  ['Hassania Agadir', 'حسنية أغادير'],
  ['Pyramids FC', 'Pyramids', 'بيراميدز'], ['Botafogo', 'Botafogo RJ', 'بوتافوجو', 'بوتافوغو'],
  ['RB Bragantino', 'Bragantino', 'Red Bull Bragantino', 'براغانتينو', 'براغانتيـنو'],
];
for (const names of aliases) {
  const existing = names.map((name) => identities.get(normalize(name))).find(Boolean);
  register(existing || `team:${normalize(names[0])}`, names);
}

export function teamIdentity(name) {
  const key = normalize(name);
  return identities.get(key) || `name:${key}`;
}

export function sameFixture(left, right) {
  const delta = Math.abs(Date.parse(left.kickoff_time) - Date.parse(right.kickoff_time));
  if (!Number.isFinite(delta) || delta > 15 * 60_000) return false;
  if (![left.home_team, left.away_team, right.home_team, right.away_team].every(Boolean)) return false;
  const category = (row) => /women|female|سيدات|نسائ/i.test(`${row.league} ${row.home_team} ${row.away_team}`);
  if (category(left) !== category(right)) return false;
  const a = [teamIdentity(left.home_team), teamIdentity(left.away_team)].sort();
  const b = [teamIdentity(right.home_team), teamIdentity(right.away_team)].sort();
  return a[0] === b[0] && a[1] === b[1];
}

export function normalizeBroadcastChannel(name) {
  const value = String(name || '').trim();
  if (!value || /\bbadge\b/i.test(value)) return '';
  if (/^SNRT(?:\s+Live)?$/i.test(value)) return 'Arryadia TNT';
  return value.replace(/^beIN Sports Mena\s*(\d+)$/i, 'beIN SPORTS HD $1');
}

export function broadcastSnapshot(row, checkedAt = new Date().toISOString()) {
  const names = row.payload?.channels ?? row.payload?.sourceChannels;
  if (!Array.isArray(names)) return null;
  const channels = [...new Set(names
    .filter((name) => typeof name === 'string' && name.trim())
    .map(normalizeBroadcastChannel)
    .filter(Boolean))];
  return {
    source: 'kooora', sourceMatchId: String(row.payload?.sourceMatchId || row.match_id),
    checkedAt, channels,
    state: channels.length ? 'assigned' : 'unassigned',
  };
}

function applyBroadcast(row, broadcast) {
  const channels = broadcast?.channels || [];
  const preferred = channels.find((name) => /beIN Sports Mena/i.test(name)) || channels[0];
  const channel = normalizeBroadcastChannel(preferred) || null;
  return {
    ...row, channel,
    payload: {
      ...row.payload, channel, channels, sourceChannels: channels, broadcast,
      channelSource: broadcast?.source === 'kooora' ? 'kooora-live-scores' : 'trusted_source_required',
      channelResolvedBy: broadcast?.source === 'kooora' ? 'kooora-exact-fixture' : null,
      channelConfidence: broadcast?.source === 'kooora' ? 1 : null,
      previousChannelPreserved: false, channelNotes: null,
    },
  };
}

export function reconcileBroadcasts(rows, { checkedAt = new Date().toISOString(), failedDates = [] } = {}) {
  const kooora = rows.filter((row) => row.source === 'kooora');
  return rows.map((row) => {
    if (row.source === 'kooora') {
      const snapshot = broadcastSnapshot(row, checkedAt);
      return applyBroadcast(row, snapshot || { source: null, checkedAt, channels: [], state: 'source_unavailable' });
    }
    if (row.source !== 'api-football') return row;
    const candidates = kooora.filter((other) => sameFixture(row, other));
    const unique = [...new Map(candidates.map((other) => [other.payload?.sourceMatchId || other.match_id, other])).values()];
    if (unique.length === 1) {
      const snapshot = broadcastSnapshot(unique[0], checkedAt);
      if (snapshot) return applyBroadcast(row, snapshot);
    }
    return applyBroadcast(row, {
      source: null, checkedAt, channels: [],
      state: failedDates.includes(String(row.kickoff_time).slice(0, 10)) ? 'source_unavailable'
        : unique.length > 1 ? 'ambiguous_fixture' : 'unmatched_fixture',
    });
  });
}

export function mergeRefreshedMatch(existing, incoming, now = Date.now()) {
  const payload = { ...existing?.payload, ...incoming.payload };
  const previous = existing?.payload?.broadcast;
  const age = now - Date.parse(previous?.checkedAt);
  // Retain verified assignments briefly only on transport failure, never after an authoritative empty result.
  if (incoming.payload?.broadcast?.state === 'source_unavailable' && previous?.source === 'kooora'
    && age >= 0 && age < 6 * 60 * 60_000) {
    return applyBroadcast({ ...incoming, payload }, { ...previous, stale: true });
  }
  if (incoming.payload?.broadcast?.state === 'unassigned' && previous?.source === 'kooora'
    && Array.isArray(previous.channels) && previous.channels.length
    && age >= 0 && age < 24 * 60 * 60_000) {
    return applyBroadcast({ ...incoming, payload }, { ...previous, stale: true, state: 'assigned' });
  }
  return { ...incoming, channel: incoming.channel || null, payload: { ...payload, channel: incoming.channel || null } };
}

export function broadcastChannelCandidates(row) {
  const snapshot = row.payload?.broadcast;
  if (snapshot?.source !== 'kooora') return [];
  const names = snapshot.channels;
  const isArabicBroadcaster = (name) => /[\u0600-\u06ff]/u.test(name)
    || (/\bbein\b/i.test(name) && !/\b(?:eng|english|fr|french|turkish)\b/i.test(name))
    || /\b(?:arryadia|arriadia|snrt|ssc|al.?kass|abu dhabi sports|dubai sports|on time sports|nile sports|saudi sports|ksa sports|kuwait sports|oman sports|jordan sports)\b/i.test(name);
  return [...new Set((names || []).filter((name) => typeof name === 'string' && name.trim()).map(normalizeBroadcastChannel))]
    .map((name, index) => ({ name, index, arabic: isArabicBroadcaster(name) }))
    .sort((left, right) => Number(right.arabic) - Number(left.arabic) || left.index - right.index)
    .map(({ name }) => name);
}

function moroccoDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function obsoleteMatchRows(existing, fresh, now = Date.now()) {
  const family = (row) => String(row.source).startsWith('kooora') ? 'kooora' : row.source;
  const managed = new Set(['kooora', 'metascrape', 'api-football']);
  const todayKey = moroccoDateKey(now);
  return existing.filter((row) => {
    if (!managed.has(family(row))) return false;
    // Keep every fixture from the current Morocco calendar day visible until 23:59,
    // even if it finished or a newer sync did not return it.
    if (moroccoDateKey(row.kickoff_time) === todayKey) return false;
    if (Date.parse(row.kickoff_time) < now - 24 * 60 * 60_000
      || Date.parse(row.updated_at) < now - 24 * 60 * 60_000) return true;
    return fresh.some((replacement) => replacement.match_id !== row.match_id
      && family(replacement) === family(row)
      && replacement.payload?.broadcast?.source === 'kooora'
      && (Date.parse(replacement.updated_at) > Date.parse(row.updated_at)
        || (replacement.updated_at === row.updated_at && replacement.match_id < row.match_id))
      && sameFixture(row, replacement));
  });
}

export function deduplicateSourceEvents(rows) {
  const events = new Map();
  for (const row of rows) {
    const sourceId = row.payload?.sourceMatchId;
    const key = String(row.source).startsWith('kooora') && sourceId
      ? `kooora:${sourceId}:${String(row.kickoff_time).slice(0, 10)}` : row.match_id || row.id;
    const previous = events.get(key);
    if (!previous || Date.parse(row.updated_at) > Date.parse(previous.updated_at)
      || (row.updated_at === previous.updated_at && row.source === 'kooora')) events.set(key, row);
  }
  return [...events.values()];
}
