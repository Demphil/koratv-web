import "../src/lib/loadEnv.js";
import * as cheerio from "cheerio";
import { fileURLToPath } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { isAllowedMatch, normalizeTeamName } from "../../shared/league-whitelist.mjs";
import { reconcileBroadcasts, mergeRefreshedMatch, sameFixture, preferredBroadcastChannels } from "../../shared/match-broadcasts.mjs";
import { pruneMatchData } from './prune-match-data.js';
import { sourceMatchState } from '../../shared/match-lifecycle.mjs';
import { normalizeKnockoutFixtures } from '../../shared/knockout.mjs';

const BASE_SITE_URL = process.env.MATCH_SOURCE_URL || "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D8%A8%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D9%8A%D9%88%D9%85";
const FIXTURES_SITE_URL = "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D9%88%D8%A7%D8%B9%D9%8A%D8%AF-%D8%A7%D9%84%D9%85%D8%A8%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA";
const TV_SCHEDULE_SITE_URL = process.env.KOOORA_TV_SCHEDULE_URL || "https://www.kooora.com/%D8%A3%D8%AD%D8%AF%D8%A7%D8%AB-%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A9/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85";
const matchesTable = process.env.SUPABASE_MATCHES_TABLE || "matches";
const dryRun = process.argv.includes("--dry-run");
const apiFootballKey = process.env.API_FOOTBALL_KEY
  || process.env.APIFOOTBALL_KEY
  || process.env.FOOTBALL_API_KEY
  || process.env.RAPIDAPI_KEY
  || "";
const apiFootballBaseUrl = (process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/+$/, "");
const apiFootballDetailLimit = Math.min(20, Math.max(1, Number(process.env.API_FOOTBALL_DETAIL_LIMIT || 20)));
const liveDetailsRefreshMs = Math.max(5, Number(process.env.API_FOOTBALL_LIVE_DETAILS_REFRESH_MINUTES || 5)) * 60_000;
const lineupDetailsRefreshMs = Math.max(15, Number(process.env.API_FOOTBALL_LINEUP_DETAILS_REFRESH_MINUTES || 15)) * 60_000;
const standingsRefreshMs = Math.max(1, Number(process.env.API_FOOTBALL_STANDINGS_REFRESH_HOURS || 24)) * 60 * 60_000;
const standingsLimit = Math.max(0, Number(process.env.API_FOOTBALL_STANDINGS_PER_SYNC || 1));
const knockoutRefreshMs = 4 * 60 * 60_000;
const apiFootballTodayRefreshMs = Math.max(5, Number(process.env.API_FOOTBALL_TODAY_REFRESH_MINUTES || 10)) * 60_000;
const apiFootballTomorrowRefreshMs = Math.max(1, Number(process.env.API_FOOTBALL_TOMORROW_REFRESH_HOURS || 12)) * 60 * 60_000;
const koooraDetailChannelLimit = Math.max(0, Number(process.env.KOOORA_DETAIL_CHANNEL_LIMIT || 20));
const apiFootballFixtureCache = new Map();


function moroccoDateParts(offsetDays = 0) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function convertSourceToMoroccoTime(timeString) {
  if (!timeString || !timeString.includes(":")) {
    return { formatted: timeString || "", rawMinutes: null };
  }

  const cleanedString = timeString.replace(/\s+/g, " ").trim();
  const [timePart, ampm] = cleanedString.split(" ");
  let [hours, minutes] = timePart.split(":").map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return { formatted: timeString, rawMinutes: null };
  }

  if (ampm) {
    if (ampm.toUpperCase().includes("PM") && hours !== 12) hours += 12;
    if (ampm.toUpperCase().includes("AM") && hours === 12) hours = 0;
  }

  hours -= Number(process.env.MATCH_SOURCE_UTC_OFFSET_DELTA || 2);
  if (hours < 0) hours += 24;

  return {
    formatted: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    rawMinutes: hours * 60 + minutes
  };
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function matchSlug(homeTeam, awayTeam) {
  return `${slugify(normalizeTeamName(homeTeam))}_vs_${slugify(normalizeTeamName(awayTeam))}`;
}

function fixturesUrlForDate(date) {
  return process.env.MATCH_SOURCE_TOMORROW_URL || `${FIXTURES_SITE_URL}/${date}`;
}

function apiFootballEnabled() {
  return Boolean(apiFootballKey) && process.env.MATCH_SOURCE_PROVIDER !== "kooora";
}

async function fetchApiFootball(path, params = {}) {
  const url = new URL(`${apiFootballBaseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers = {
    "x-apisports-key": apiFootballKey,
    "accept": "application/json"
  };
  if (/rapidapi/i.test(apiFootballBaseUrl) || process.env.RAPIDAPI_KEY) {
    headers["x-rapidapi-key"] = apiFootballKey;
    headers["x-rapidapi-host"] = process.env.API_FOOTBALL_RAPIDAPI_HOST || "v3.football.api-sports.io";
  }

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`API-Football ${path} failed with ${response.status}`);
  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new Error(`API-Football ${path} error: ${body.errors.join(", ")}`);
  }
  if (body?.errors && typeof body.errors === "object" && Object.keys(body.errors).length) {
    throw new Error(`API-Football ${path} error: ${JSON.stringify(body.errors)}`);
  }
  return Array.isArray(body?.response) ? body.response : [];
}

function apiFootballStatus(status = {}) {
  const short = String(status.short || "").toUpperCase();
  const elapsed = Number(status.elapsed);
  const state = sourceMatchState({ status: short || status.long });
  return {
    raw: short || String(status.long || "FIXTURE").toUpperCase(),
    isLive: state === 'live',
    isFinished: state === 'ended',
    liveMinute: Number.isFinite(elapsed) ? elapsed : null
  };
}

function apiFootballScore(fixture = {}) {
  const home = fixture?.goals?.home;
  const away = fixture?.goals?.away;
  return home != null && away != null && Number.isFinite(Number(home)) && Number.isFinite(Number(away)) ? `${home} - ${away}` : "VS";
}

function apiFootballEventSide(event, homeName, awayName) {
  const teamName = normalizeTeamName(event?.team?.name || "");
  if (teamName && teamName === normalizeTeamName(homeName)) return "home";
  if (teamName && teamName === normalizeTeamName(awayName)) return "away";
  return "";
}

function apiFootballEvents(events = [], homeName, awayName) {
  const goals = [];
  const yellowCards = { home: 0, away: 0 };
  const redCards = { home: 0, away: 0 };

  for (const event of events) {
    const side = apiFootballEventSide(event, homeName, awayName);
    const type = String(event?.type || "").toLowerCase();
    const detail = String(event?.detail || "").toLowerCase();
    const minute = event?.time?.elapsed ?? "";
    const player = event?.player?.name || "";
    if (type === "goal" && player) goals.push({ player, minute, team: side });
    if (type === "card" && side && /yellow/.test(detail)) yellowCards[side] += 1;
    if (type === "card" && side && /red/.test(detail)) redCards[side] += 1;
  }

  return {
    goals,
    yellowCards: yellowCards.home || yellowCards.away ? yellowCards : null,
    redCards: redCards.home || redCards.away ? redCards : null
  };
}

function apiFootballPhoto(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "media.api-sports.io" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeApiFootballLineups(lineups = [], playerStatistics = []) {
  if (!Array.isArray(lineups)) return [];
  return lineups.slice(0, 2).map((lineup) => {
    const teamStats = (Array.isArray(playerStatistics) ? playerStatistics : []).find(team => String(team?.team?.id) === String(lineup?.team?.id));
    const ratings = new Map((teamStats?.players || []).map(entry => [String(entry?.player?.id), entry?.statistics?.[0]?.games?.rating]));
    const player = (item) => {
      const person = item?.player || {};
      const id = Number(person.id) || null;
      return {
        id,
        name: String(person.name || "").slice(0, 90),
        number: Number(person.number) || null,
        position: String(person.pos || "").slice(0, 12),
        grid: String(person.grid || "").slice(0, 12),
        rating: ratings.get(String(id)) != null && Number.isFinite(Number(ratings.get(String(id))))
          && Number(ratings.get(String(id))) >= 0 && Number(ratings.get(String(id))) <= 10 ? Number(ratings.get(String(id))) : null,
        photo: apiFootballPhoto(person.photo) || (id ? `https://media.api-sports.io/football/players/${id}.png` : "")
      };
    };
    return {
      team: {
        id: lineup?.team?.id || null,
        name: String(lineup?.team?.name || "").slice(0, 90),
        logo: apiFootballPhoto(lineup?.team?.logo)
      },
      formation: String(lineup?.formation || "").slice(0, 16),
      coach: {
        id: lineup?.coach?.id || null,
        name: String(lineup?.coach?.name || "").slice(0, 90),
        photo: apiFootballPhoto(lineup?.coach?.photo)
          || (Number(lineup?.coach?.id) ? `https://media.api-sports.io/football/coachs/${Number(lineup.coach.id)}.png` : "")
      },
      startXI: (Array.isArray(lineup?.startXI) ? lineup.startXI : []).slice(0, 11).map(player),
      substitutes: (Array.isArray(lineup?.substitutes) ? lineup.substitutes : []).slice(0, 15).map(player)
    };
  });
}

export function normalizeApiFootballStatistics(statistics = []) {
  if (!Array.isArray(statistics)) return [];
  return statistics.slice(0, 2).map((team) => ({
    team: { id: team?.team?.id || null, name: String(team?.team?.name || "").slice(0, 90) },
    statistics: (Array.isArray(team?.statistics) ? team.statistics : []).slice(0, 50).map((item) => ({
      type: String(item?.type || "").slice(0, 60),
      value: item?.value == null ? null : String(item.value).slice(0, 40)
    }))
  }));
}

export function normalizeApiFootballStandings(groups = [], fixture = null) {
  if (!Array.isArray(groups)) return [];
  if (fixture) {
    groups = groups.filter(group => Array.isArray(group) && [fixture.payload?.homeTeamId, fixture.payload?.awayTeamId]
      .every(id => id && group.some(row => String(row.team?.id) === String(id))));
  }
  return groups.flat().slice(0, 40).map((row) => ({
    rank: Number(row?.rank) || null,
    team: String(row?.team?.name || "").slice(0, 90),
    points: Number(row?.points) || 0,
    played: Number(row?.all?.played) || 0,
    goalDifference: Number(row?.goalsDiff) || 0,
    form: String(row?.form || "").slice(0, 20)
  })).filter((row) => row.team);
}

export function normalizeApiFootballEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 100).map((event) => ({
    elapsed: Number(event?.time?.elapsed) || null,
    extra: Number(event?.time?.extra) || null,
    team: String(event?.team?.name || "").slice(0, 90),
    player: String(event?.player?.name || "").slice(0, 90),
    assist: String(event?.assist?.name || "").slice(0, 90),
    type: String(event?.type || "").slice(0, 40),
    detail: String(event?.detail || "").slice(0, 60),
    comments: String(event?.comments || "").slice(0, 100)
  }));
}

async function collectApiFootballRows() {
  const dates = [
    { date: moroccoDateParts(0), refreshMs: apiFootballTodayRefreshMs },
    { date: moroccoDateParts(1), refreshMs: apiFootballTomorrowRefreshMs }
  ];
  const rows = [];

  for (const { date, refreshMs } of dates) {
    let cached = apiFootballFixtureCache.get(date);
    if (!cached || Date.now() - cached.updatedAt >= refreshMs) {
      try {
        const fixtures = await fetchApiFootball("/fixtures", { date, timezone: "Africa/Casablanca" });
        cached = { fixtures, updatedAt: Date.now() };
        apiFootballFixtureCache.set(date, cached);
      } catch (error) {
        if (!cached) throw error;
        console.warn(`Using cached API-Football fixtures for ${date}: ${error.message}`);
      }
    }
    const fixtures = cached?.fixtures || [];
    for (const fixture of fixtures) {
      const homeTeam = fixture?.teams?.home?.name?.trim();
      const awayTeam = fixture?.teams?.away?.name?.trim();
      const league = fixture?.league?.name || "";
      const leagueCountry = fixture?.league?.country || "";
      const kickoff = fixture?.fixture?.date;
      if (!homeTeam || !awayTeam || !kickoff) continue;
      if (!isAllowedMatch({ league, leagueCountry, homeTeam, awayTeam })) continue;

      const status = apiFootballStatus(fixture?.fixture?.status);
      const baseMatchId = matchSlug(homeTeam, awayTeam);
      const date = String(kickoff).slice(0, 10);
      const matchId = `api-football_${date}_${baseMatchId}`;
      const row = {
        id: matchId,
        match_id: matchId,
        home_team: homeTeam,
        away_team: awayTeam,
        league,
        kickoff_time: kickoff,
        channel: null,
        source: "api-football",
        active: true,
        payload: {
          score: apiFootballScore(fixture),
          status: status.raw,
          isLive: status.isLive,
          isFinished: status.isFinished,
          liveMinute: status.liveMinute,
          time: new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Casablanca", hourCycle: "h23", hour: "2-digit", minute: "2-digit"
          }).format(new Date(kickoff)),
          homeLogo: fixture?.teams?.home?.logo || "",
          awayLogo: fixture?.teams?.away?.logo || "",
          homeTeamId: fixture?.teams?.home?.id || null,
          awayTeamId: fixture?.teams?.away?.id || null,
          leagueId: fixture?.league?.id || null,
          season: fixture?.league?.season || null,
          leagueType: fixture?.league?.type || '',
          leagueRound: fixture?.league?.round || '',
          leagueCountry,
          sourceFixtureId: fixture?.fixture?.id || "",
          channelSource: "trusted_source_required",
          dataSource: "api-football"
        },
        updated_at: new Date().toISOString()
      };
      rows.push(row);
    }
  }

  console.log(`Parsed ${rows.length} matches from API-Football (${dates.map(({ date }) => date).join(", ")}).`);
  return rows;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": "Mozilla/5.0 koratv metascrape/1.0",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

function parseMatches(html, dayOffset) {
  if (html.includes('__NEXT_DATA__')) return parseKoooraMatches(html);

  const $ = cheerio.load(html);
  const rows = [];
  const date = moroccoDateParts(dayOffset);

  $(".AY_Match").each((_, element) => {
    const matchEl = $(element);
    const homeTeam = matchEl.find(".MT_Team.TM1 .TM_Name").first().text().trim();
    const awayTeam = matchEl.find(".MT_Team.TM2 .TM_Name").first().text().trim();
    if (!homeTeam || !awayTeam) return;

    const scoreValues = matchEl.find(".MT_Result .RS-goals").map((__, item) => $(item).text().trim()).get();
    const score = scoreValues.length === 2 && scoreValues.every((value) => /^\d+$/.test(value))
      ? `${scoreValues[0]} - ${scoreValues[1]}`
      : "VS";
    const time = convertSourceToMoroccoTime(matchEl.find(".MT_Time").first().text().trim());
    const infoItems = matchEl.find(".MT_Info ul li").map((__, item) => $(item).text().trim()).get();
    const league = infoItems[infoItems.length - 1] || "League";
    if (!isAllowedMatch({ league, homeTeam, awayTeam })) return;
    const commentator = infoItems[1] || "";
    const baseMatchId = matchSlug(homeTeam, awayTeam);
    const matchId = `kooora_${date}_${baseMatchId}`;

    rows.push({
      id: matchId,
      match_id: matchId,
      home_team: homeTeam,
      away_team: awayTeam,
      league,
      kickoff_time: time.formatted && time.formatted.includes(":") ? `${date}T${time.formatted}:00+01:00` : null,
      channel: null,
      source: "metascrape",
      active: true,
      payload: {
        score,
        time: time.formatted,
        commentator: /غير معروف|unknown/i.test(commentator) ? "" : commentator,
        matchLink: matchEl.find("a").first().attr("href") || "",
        channelSource: "trusted_source_required"
      },
      updated_at: new Date().toISOString()
    });
  });

  return rows;
}

function scorePart(score, side) {
  const value = score?.[side] ?? score?.[side === "teamA" ? "home" : "away"];
  if (value && typeof value === "object") return value.score ?? value.value ?? value.total;
  return value;
}

function normalizeKoooraChannel(value) {
  const name = String(value || '').trim();
  const beinNumber = name.match(/beIN\s*Sports\s*Mena\s*(\d+)/i)?.[1];
  return beinNumber ? `beIN SPORTS HD ${beinNumber}` : name || null;
}

function cleanKoooraBroadcastName(value) {
  let name = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:شاهد|مشاهدة)\s+(?:المباراة\s+)?(?:مباشرة\s+)?على/giu, ' ')
    .replace(/\bwatch\s+(?:live\s+)?(?:on|via)\b/giu, ' ')
    .replace(/\b(?:live|stream|broadcast|channel|logo|شعار)\b/giu, ' ')
    .replace(/^[\s:：|،,\-–—]+|[\s:：|،,\-–—]+$/g, '')
    .trim();
  if (!name || name.length > 64) return null;
  if (/(?:تذاكر|اشترك|تحميل|التطبيق|google|apple|app store|مواعيد|نتائج|تفاصيل|ملخص|ترتيب)/iu.test(name)) return null;
  return normalizeKoooraChannel(name);
}

function isGenericViewingPlatform(name) {
  return /^(?:fubo\s*tv|disney\+?|disney\s+plus|dazn|tod(?:\s+tv)?|shahid|starzplay|apple\s+tv|paramount\+?|peacock|prime\s+video|amazon\s+prime|youtube|vidio|ais\s+play|dstv\s+now|movistar\s+plus\+?)$/iu
    .test(String(name || '').trim());
}

function isLikelySportsBroadcaster(name) {
  return /\b(?:bein|ssc|alkass|al\s*kass|arryadia|arriadia|snrt|abu\s*dhabi\s*sports?|dubai\s*sports?|sharjah\s*sports?|on\s*time\s*sports?|nile\s*sports?|ksa\s*sports?|saudi\s*sports?|kuwait\s*sports?|oman\s*sports?|jordan\s*sports?|super\s*sport|supersport|sabc\s*plus|cbc\s*sport|mbc\s*action|mbc\s*masr|ad\s*sports?|yas\s*sports?|riyadiya)\b/iu
    .test(String(name || ''));
}

function uniqueChannelNames(names) {
  const seen = new Set();
  return names.map(cleanKoooraBroadcastName).filter(Boolean).filter((name) => {
    const key = normalizeLookup(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preferRealBroadcastChannels(names) {
  const cleaned = uniqueChannelNames(names);
  const sports = cleaned.filter(isLikelySportsBroadcaster);
  if (sports.length) return sports;
  const nonPlatform = cleaned.filter((name) => !isGenericViewingPlatform(name));
  return nonPlatform.length ? nonPlatform : cleaned;
}

function collectKoooraDomChannelCandidates($, matchId = '') {
  const roots = [];
  if (matchId) {
    const byId = $(`[data-match-id="${matchId}"],[data-event-id="${matchId}"],[data-fixture-id="${matchId}"],[href*="${matchId}"]`);
    byId.each((_, item) => {
      const root = $(item).closest('article,section,li,[class*="match"],[class*="fixture"],[class*="event"],div').first();
      roots.push(root.length ? root : $(item));
    });
  }
  if (!roots.length) roots.push($('body'));

  const candidates = [];
  const addCandidate = (value) => {
    const cleaned = cleanKoooraBroadcastName(value);
    if (cleaned) candidates.push(cleaned);
  };

  for (const root of roots) {
    root.find('[data-channel],[data-broadcaster],[data-provider-name],[aria-label],img[alt],img[title]').each((_, item) => {
      const element = $(item);
      addCandidate(element.attr('data-channel') || element.attr('data-broadcaster') || element.attr('data-provider-name')
        || element.attr('aria-label') || element.attr('alt') || element.attr('title'));
    });

    root.find('*').each((_, item) => {
      const element = $(item);
      const marker = `${element.attr('class') || ''} ${element.attr('id') || ''}`.toLowerCase();
      const text = element.text();
      if (/(?:channel|broadcast|provider|watch|tv|stream|قنوات|ناقلة|بث|شاهد)/i.test(marker)
        || /(?:شاهد|مشاهدة)\s+(?:المباراة\s+)?(?:مباشرة\s+)?على|watch\s+(?:live\s+)?(?:on|via)/iu.test(text)) {
        for (const line of text.split(/\n| {2,}/)) addCandidate(line);
      }
    });
  }

  return preferRealBroadcastChannels(candidates);
}

export function extractKoooraBroadcastChannelsFromHtml(html, matchId = '') {
  const $ = cheerio.load(html || '');
  const names = [];
  const raw = $('#__NEXT_DATA__').text();
  if (raw) {
    try {
      const page = JSON.parse(raw);
      const tvChannels = page?.props?.pageProps?.data?.tvChannels;
      if (Array.isArray(tvChannels)) names.push(...tvChannels.map((channel) => channel?.name || channel?.title || channel?.label));
    } catch {}
  }
  names.push(...collectKoooraDomChannelCandidates($, matchId));
  return preferRealBroadcastChannels(names);
}

function koooraChannelNamesForMatch($, match) {
  return preferRealBroadcastChannels([
    ...(Array.isArray(match.tvChannels) ? match.tvChannels.map((channel) => channel?.name || channel?.title || channel?.label) : []),
    ...collectKoooraDomChannelCandidates($, match.id || '')
  ]);
}

function koooraMatchLink(match = {}) {
  const direct = match?.link?.url;
  if (direct) return direct.startsWith('http') ? direct : new URL(direct, 'https://www.kooora.com').href;
  if (!match?.id) return '';
  const slug = match?.link?.slug || matchSlug(match?.teamA?.name || 'team-a', match?.teamB?.name || 'team-b');
  return new URL(`/كرة-القدم/مباراة/${slug}/${match.id}`, 'https://www.kooora.com').href;
}

function parseScheduleEventTeams(name = '') {
  const parts = String(name || '').split(/\s+(?:ضد|vs\.?|v)\s+/iu).map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? { homeTeam: parts[0], awayTeam: parts.slice(1).join(' ضد ') } : null;
}

export function parseKoooraScheduleBroadcasts(html) {
  const $ = cheerio.load(html || '');
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) return [];
  let page;
  try { page = JSON.parse(raw); } catch { return []; }
  const data = page?.props?.pageProps?.data || {};
  const groups = [
    ...(Array.isArray(data.scheduleGroups) ? data.scheduleGroups : []),
    { competition: null, events: Array.isArray(data.featuredEntries) ? data.featuredEntries : [] }
  ];
  const rows = [];
  for (const group of groups) {
    for (const event of group.events || []) {
      const teams = parseScheduleEventTeams(event.name);
      const channels = preferRealBroadcastChannels((event.schedule || []).map((item) => item?.name));
      if (!teams || !event.startDate || !channels.length) continue;
      rows.push({
        match_id: `kooora_schedule_${event.link?.id || matchSlug(teams.homeTeam, teams.awayTeam)}`,
        source: 'kooora-schedule',
        home_team: teams.homeTeam,
        away_team: teams.awayTeam,
        league: group.competition?.name || event.competition?.name || '',
        kickoff_time: event.startDate,
        payload: {
          sourceMatchId: event.link?.id || '',
          channels,
          sourceChannels: channels,
          matchLink: event.link?.url || ''
        }
      });
    }
  }
  return rows;
}

function normalizeLookup(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventTeamSide(event = {}) {
  const raw = String(
    event.team
    || event.side
    || event.teamSide
    || event.contestant
    || event.teamType
    || event.participant
    || event.competitor
    || event.owner
    || event.club
    || ""
  ).toLowerCase();
  if (/home|teama|local|1|الفريق الاول|صاحب الارض/.test(raw)) return "home";
  if (/away|teamb|visitor|2|الفريق الثاني|الضيف/.test(raw)) return "away";
  const code = String(event.teamCode || event.teamId || event.contestantId || "").toLowerCase();
  if (/^(?:a|home|1)$/.test(code)) return "home";
  if (/^(?:b|away|2)$/.test(code)) return "away";
  return "";
}

function collectEventObjects(value, output = [], depth = 0) {
  if (!value || depth > 6) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectEventObjects(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;

  const keys = Object.keys(value);
  const hasEventShape = keys.some((key) => /type|event|incident|minute|time|player|scorer|card|goal|team|side|period/i.test(key));
  if (hasEventShape && keys.some((key) => /minute|time|type|event|incident|card|goal|player|scorer/i.test(key))) {
    output.push(value);
  }

  for (const key of keys) {
    if (/events?|incidents?|timeline|cards?|goals?|scorers?|statistics|stats|matchFacts|keyEvents|actions|summary/i.test(key)) {
      collectEventObjects(value[key], output, depth + 1);
    }
  }
  return output;
}

function collectStatObjects(value, output = [], depth = 0) {
  if (!value || depth > 5) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectStatObjects(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  const keys = Object.keys(value);
  if (keys.some((key) => /yellow|red|card|انذار|طرد|بطاق/i.test(key))) output.push(value);
  for (const key of keys) {
    if (/stats|statistics|cards|discipline|teamStats|matchStats|summary/i.test(key)) {
      collectStatObjects(value[key], output, depth + 1);
    }
  }
  return output;
}

function readSideCount(value, side) {
  if (value == null) return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) return Number(value);
  if (typeof value !== "object") return null;
  const candidates = side === "home"
    ? [value.home, value.homeTeam, value.local, value.teamA, value.first, value[0]]
    : [value.away, value.awayTeam, value.visitor, value.teamB, value.second, value[1]];
  for (const candidate of candidates) {
    const count = readSideCount(candidate, side);
    if (Number.isFinite(count)) return count;
  }
  return null;
}

function addStatCardCounts(match, yellowCards, redCards) {
  const statObjects = collectStatObjects(match);
  for (const stats of statObjects) {
    const yellowValue = stats.yellowCards || stats.yellow || stats.yellow_cards || stats["بطاقات صفراء"] || stats["انذارات"] || stats["إنذارات"];
    const redValue = stats.redCards || stats.red || stats.red_cards || stats["بطاقات حمراء"] || stats["حالات طرد"] || stats["طرد"];
    const homeYellow = readSideCount(yellowValue, "home");
    const awayYellow = readSideCount(yellowValue, "away");
    const homeRed = readSideCount(redValue, "home");
    const awayRed = readSideCount(redValue, "away");
    if (Number.isFinite(homeYellow)) yellowCards.home = Math.max(yellowCards.home, homeYellow);
    if (Number.isFinite(awayYellow)) yellowCards.away = Math.max(yellowCards.away, awayYellow);
    if (Number.isFinite(homeRed)) redCards.home = Math.max(redCards.home, homeRed);
    if (Number.isFinite(awayRed)) redCards.away = Math.max(redCards.away, awayRed);
  }
}

function normalizeMatchEvents(match = {}) {
  const rawEvents = collectEventObjects(match);

  const goals = [];
  const yellowCards = { home: 0, away: 0 };
  const redCards = { home: 0, away: 0 };

  for (const event of rawEvents) {
    const type = String(
      event.type
      || event.eventType
      || event.incidentType
      || event.kind
      || event.name
      || event.title
      || event.label
      || event.action
      || event.cardType
      || ""
    ).toLowerCase();
    const side = eventTeamSide(event);
    const minute = event.minute ?? event.time ?? event.matchMinute ?? "";
    const player = event.player?.name || event.playerName || event.scorer?.name || event.athlete?.name || event.participantName || "";
    const eventText = `${type} ${event.description || ""} ${event.text || ""} ${event.comment || ""}`.toLowerCase();
    if (/goal|هدف/.test(eventText) && player) goals.push({ player, minute, team: side });
    if (/yellow|بطاقه صفراء|بطاقة صفراء|انذار|إنذار/.test(eventText) && side) yellowCards[side] += 1;
    if (/red|بطاقه حمراء|بطاقة حمراء|طرد/.test(eventText) && side) redCards[side] += 1;
  }

  addStatCardCounts(match, yellowCards, redCards);

  return {
    goals,
    yellowCards: yellowCards.home || yellowCards.away ? yellowCards : null,
    redCards: redCards.home || redCards.away ? redCards : null
  };
}

function matchMinute(match = {}) {
  const value = Number(match.minute ?? match.matchMinute ?? match.currentMinute ?? match.time?.minute);
  return Number.isFinite(value) && value >= 0 ? value : null;
}


export function parseKoooraMatches(html) {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) throw new Error('Kooora __NEXT_DATA__ payload is missing.');
  const page = JSON.parse(raw);
  const groups = Array.isArray(page?.props?.pageProps?.data) ? page.props.pageProps.data : [];
  const rows = [];

  for (const group of groups) {
    const league = group?.competition?.name || '';

    for (const match of group.matches || []) {
      const homeTeam = match?.teamA?.name?.trim();
      const awayTeam = match?.teamB?.name?.trim();
      const kickoff = match?.startDate;
      if (!homeTeam || !awayTeam || !kickoff) continue;
      if (!isAllowedMatch({ league, homeTeam, awayTeam })) continue;

      const status = String(match.status || 'FIXTURE').toUpperCase();
      const homeScore = scorePart(match.score, 'teamA');
      const awayScore = scorePart(match.score, 'teamB');
      const score = Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore))
        ? `${homeScore} - ${awayScore}`
        : 'VS';
      const channelNames = koooraChannelNamesForMatch($, match);
      const preferredChannel = normalizeKoooraChannel(
        preferredBroadcastChannels(channelNames)[0]
      );
      const date = String(kickoff).slice(0, 10);
      const baseMatchId = matchSlug(homeTeam, awayTeam);
      const matchId = `kooora_${date}_${baseMatchId}`;
      const events = normalizeMatchEvents(match);

      rows.push({
        id: matchId,
        match_id: matchId,
        home_team: homeTeam,
        away_team: awayTeam,
        league,
        kickoff_time: kickoff,
        channel: preferredChannel,
        source: 'kooora',
        active: true,
        payload: {
          score,
          status,
          isLive: sourceMatchState({ status }) === 'live',
          isFinished: sourceMatchState({ status }) === 'ended',
          liveMinute: matchMinute(match),
          goals: events.goals,
          yellowCards: events.yellowCards,
          redCards: events.redCards,
          time: new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Africa/Casablanca', hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
          }).format(new Date(kickoff)),
          homeLogo: match?.teamA?.image?.url || '',
          awayLogo: match?.teamB?.image?.url || '',
          channels: channelNames,
          channel: preferredChannel,
          commentator: '',
          sourceMatchId: match.id || '',
          homeSourceTeamId: match?.teamA?.id || null,
          awaySourceTeamId: match?.teamB?.id || null,
          matchLink: koooraMatchLink(match),
          channelSource: 'kooora-live-scores'
        },
        updated_at: new Date().toISOString()
      });
    }
  }

  return rows;
}

async function enrichKoooraRowsWithScheduleChannels(rows) {
  let scheduleRows = [];
  try {
    scheduleRows = parseKoooraScheduleBroadcasts(await fetchHtml(TV_SCHEDULE_SITE_URL));
  } catch (error) {
    console.warn(`Kooora schedule channel lookup failed: ${error.message}`);
    return rows;
  }
  if (!scheduleRows.length) return rows;
  for (const row of rows) {
    if (row.source !== 'kooora' || (Array.isArray(row.payload?.channels) && row.payload.channels.length)) continue;
    const exact = scheduleRows.find((item) => item.payload?.sourceMatchId && item.payload.sourceMatchId === row.payload?.sourceMatchId);
    const match = exact || scheduleRows.find((item) => sameFixture(row, item));
    const channels = match?.payload?.channels || [];
    if (!channels.length) continue;
    const preferredChannel = normalizeKoooraChannel(
      preferredBroadcastChannels(channels)[0]
    );
    row.channel = preferredChannel;
    row.payload = {
      ...row.payload,
      channel: preferredChannel,
      channels,
      sourceChannels: channels,
      scheduleChannelsFetchedAt: new Date().toISOString()
    };
  }
  return rows;
}

export function mergeMatchPayload(existingPayload = {}, refreshedPayload = {}) {
  return { ...existingPayload, ...refreshedPayload };
}

async function mergeExistingChannels(supabase, rows) {
  const matchIds = rows.map((row) => row.match_id).filter(Boolean);
  if (!matchIds.length) return { rows, versions: new Map() };

  const { data, error } = await supabase
    .from(matchesTable)
    .select("match_id,channel,payload,updated_at")
    .in("match_id", matchIds);

  if (error) {
    throw new Error(`Cannot safely merge current match snapshots (${error.code || 'network'})`);
  }

  const existingByMatchId = new Map((data || []).map((row) => [row.match_id, row]));
  const merged = rows.map((row) => {
    const existing = existingByMatchId.get(row.match_id);
    return mergeRefreshedMatch(existing, row);
  });
  return { rows: merged, versions: new Map((data || []).map((row) => [row.match_id, row.updated_at])) };
}

export async function persistMatchSnapshots(supabase, rows, versions) {
  const inserts = rows.filter((row) => !versions.has(row.match_id));
  let written = 0;
  if (inserts.length) {
    const { data, error } = await supabase.from(matchesTable)
      .upsert(inserts, { onConflict: 'match_id', ignoreDuplicates: true }).select('match_id');
    if (error) throw error;
    written += data.length;
  }
  const updates = rows.filter((row) => versions.has(row.match_id));
  // Compare-and-swap prevents overlapping scheduled syncs from replacing a newer snapshot.
  for (let offset = 0; offset < updates.length; offset += 4) {
    const counts = await Promise.all(updates.slice(offset, offset + 4).map(async (row) => {
      const expected = versions.get(row.match_id);
      if (expected && Date.parse(expected) > Date.parse(row.updated_at)) return 0;
      let query = supabase.from(matchesTable).update(row).eq('match_id', row.match_id);
      query = expected ? query.eq('updated_at', expected) : query.is('updated_at', null);
      const { data, error } = await query.select('match_id');
      if (error) throw error;
      return data.length;
    }));
    written += counts.reduce((sum, count) => sum + count, 0);
  }
  return written;
}

export async function enrichApiFootballMatchDetails(rows) {
  if (!apiFootballEnabled()) return rows;
  const now = Date.now();
  const targets = rows.filter((row) => {
    const fixtureId = Number(row.payload?.sourceFixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) return false;
    const kickoff = new Date(row.kickoff_time).getTime();
    const age = now - kickoff;
    const refreshedAt = new Date(row.payload?.detailsUpdatedAt || 0).getTime();
    const hasDetails = Array.isArray(row.payload?.events) && row.payload.events.length > 0;
    if (row.payload?.isFinished) return !row.payload?.eventDetailsLoaded;
    if (row.payload?.isLive) return !Number.isFinite(refreshedAt) || now - refreshedAt >= liveDetailsRefreshMs;
    return age >= -60 * 60_000 && age < 0
      && ((!hasDetails && !row.payload?.detailsUpdatedAt) || now - refreshedAt >= lineupDetailsRefreshMs);
  }).slice(0, apiFootballDetailLimit);
  if (targets.length) {
    try {
      const fixtures = await fetchApiFootball("/fixtures", { ids: targets.map((row) => row.payload.sourceFixtureId).join("-") });
      const detailsById = new Map(fixtures.map((fixture) => [String(fixture?.fixture?.id || ""), fixture]));
      for (const row of targets) {
        const detail = detailsById.get(String(row.payload.sourceFixtureId));
        if (!detail) continue;
        const normalizedEvents = normalizeApiFootballEvents(detail.events);
        const eventSummary = apiFootballEvents(detail.events, row.home_team, row.away_team);
        row.payload = {
          ...row.payload,
          ...(Array.isArray(detail.events) ? { events: normalizedEvents, ...eventSummary } : {}),
          ...(Array.isArray(detail.lineups) ? { lineups: normalizeApiFootballLineups(detail.lineups, detail.players) } : {}),
          ...(detail.league ? { leagueId: detail.league.id, season: detail.league.season,
            leagueType: detail.league.type || '', leagueRound: detail.league.round || '' } : {}),
          ...(Array.isArray(detail.statistics) ? { statistics: normalizeApiFootballStatistics(detail.statistics) } : {}),
          ...(detail.fixture?.venue?.name ? { venue: String(detail.fixture.venue.name).slice(0, 120) } : {}),
          ...(detail.fixture?.venue?.city ? { venueCity: String(detail.fixture.venue.city).slice(0, 90) } : {}),
          ...(detail.fixture?.referee ? { referee: String(detail.fixture.referee).slice(0, 90) } : {}),
          eventDetailsLoaded: true,
          detailsUpdatedAt: new Date(now).toISOString()
        };
      }
    } catch (error) {
      console.warn(`API-Football batched fixture details failed: ${error.message}`);
    }
  }

  if (standingsLimit > 0) {
    const dueLeagues = [...new Map(rows.filter((row) => row.payload?.leagueId && row.payload?.season)
      .filter((row) => row.payload?.standingsVersion !== 2 || now - new Date(row.payload?.standingsUpdatedAt || 0).getTime() >= standingsRefreshMs)
      .map((row) => [`${row.payload.leagueId}:${row.payload.season}`, row])).values()]
      .slice(0, standingsLimit);
    for (const row of dueLeagues) {
      try {
        const response = await fetchApiFootball("/standings", { league: row.payload.leagueId, season: row.payload.season });
        const leagueKey = `${row.payload.leagueId}:${row.payload.season}`;
        for (const related of rows.filter((item) => `${item.payload?.leagueId}:${item.payload?.season}` === leagueKey)) {
          const standings = normalizeApiFootballStandings(response[0]?.league?.standings || [], related);
          related.payload = { ...related.payload, standings, standingsVersion: 2, standingsUpdatedAt: new Date(now).toISOString() };
        }
      } catch (error) {
        console.warn(`API-Football standings failed for league ${row.payload.leagueId}: ${error.message}`);
      }
    }
  }
  // Brackets are fetched in background, never during a visitor's Play request.
  const dueCup = rows.find(row => row.payload?.leagueId && row.payload?.season
    && (/^cup$/i.test(row.payload.leagueType || '') || /^semi[ -]?finals?$|^final$/i.test(row.payload.leagueRound || ''))
    && (!row.payload.knockoutUpdatedAt || now - Date.parse(row.payload.knockoutUpdatedAt) >= knockoutRefreshMs));
  if (dueCup) {
    try {
      const fixtures = await fetchApiFootball('/fixtures', { league: dueCup.payload.leagueId, season: dueCup.payload.season });
      const knockout = normalizeKnockoutFixtures(fixtures, dueCup.payload.leagueId, dueCup.payload.season);
      for (const related of rows.filter(row => String(row.payload?.leagueId) === String(dueCup.payload.leagueId)
        && String(row.payload?.season) === String(dueCup.payload.season))) {
        related.payload = { ...related.payload, ...(knockout ? { knockout } : {}), knockoutUpdatedAt: new Date(now).toISOString() };
      }
    } catch (error) { console.warn(`API-Football knockout refresh failed: ${error.message}`); }
  }
  const currentFixtures = new Map(rows.filter(row => row.source === 'api-football').map(row => [String(row.payload?.sourceFixtureId),row]));
  for (const row of rows) {
    if (!row.payload?.knockout?.rounds) continue;
    row.payload.knockout = { ...row.payload.knockout, rounds: row.payload.knockout.rounds.map(round => ({
      ...round, matches: round.matches.map(fixture => {
        const current = currentFixtures.get(String(fixture.fixtureId));
        return current ? { ...fixture, score: current.payload.score || fixture.score, status: current.payload.status || fixture.status } : fixture;
      }),
    })) };
  }
  return rows;
}

async function enrichKoooraRowsWithDetailChannels(rows) {
  const targets = rows.filter((row) =>
    row.source === 'kooora'
    && !(Array.isArray(row.payload?.channels) && row.payload.channels.length)
    && row.payload?.matchLink
  ).slice(0, koooraDetailChannelLimit);

  for (const row of targets) {
    try {
      const html = await fetchHtml(row.payload.matchLink);
      const channels = extractKoooraBroadcastChannelsFromHtml(html, row.payload?.sourceMatchId || '');
      if (!channels.length) continue;
      const preferredChannel = normalizeKoooraChannel(
        preferredBroadcastChannels(channels)[0]
      );
      row.channel = preferredChannel;
      row.payload = {
        ...row.payload,
        channel: preferredChannel,
        channels,
        sourceChannels: channels,
        detailChannelsFetchedAt: new Date().toISOString()
      };
    } catch (error) {
      console.warn(`Kooora match detail channel lookup failed for ${row.match_id}: ${error.message}`);
    }
  }
  return rows;
}

export async function collectMatchRowsFromSource() {
  const provider = String(process.env.MATCH_SOURCE_PROVIDER || "").trim().toLowerCase();
  let rows = [];
  if (apiFootballEnabled()) {
    try {
      rows.push(...await collectApiFootballRows());
      if (!rows.length && provider !== "both") console.warn("API-Football returned no allowed matches; falling back to Kooora source.");
    } catch (error) {
      console.error(`API-Football source failed: ${error.message}; falling back to Kooora source.`);
    }
  }

  const tomorrowDate = moroccoDateParts(1);
  const pages = [
    { url: BASE_SITE_URL, dayOffset: 0 },
    { url: fixturesUrlForDate(tomorrowDate), dayOffset: 1 },
  ];
  const koooraRows = [];
  const failedDates = [];
  const checkedAt = new Date().toISOString();

  for (const page of pages) {
    try {
      const html = await fetchHtml(page.url);
      koooraRows.push(...parseMatches(html, page.dayOffset));
    } catch (error) {
      failedDates.push(moroccoDateParts(page.dayOffset));
      console.error(`Failed source ${page.url}: ${error.message}`);
    }
  }

  await enrichKoooraRowsWithScheduleChannels(koooraRows);
  await enrichKoooraRowsWithDetailChannels(koooraRows);
  rows.push(...koooraRows);
  const uniqueRows = [...new Map(rows.map((row) => [`${String(row.kickoff_time || '').slice(0, 10)}:${row.match_id}`, row])).values()];
  console.log(`Parsed ${uniqueRows.length} matches from ${pages.map((page) => page.url).join(', ')}.`);
  return reconcileBroadcasts(uniqueRows, { checkedAt, failedDates });
}

export async function upsertMatchRows(rows, { prune = true } = {}) {
  const supabase = getSupabaseAdmin();
  const withExisting = await mergeExistingChannels(supabase, rows);
  const enriched = await enrichApiFootballMatchDetails(withExisting.rows);
  const finalRowsForUpsert = enriched;

  const written = await persistMatchSnapshots(supabase, finalRowsForUpsert, withExisting.versions);
  console.log(`Stored ${written}/${finalRowsForUpsert.length} match snapshots; concurrent newer snapshots preserved.`);
  if (prune) await pruneMatchData(supabase, matchesTable);

  return { parsed: rows.length, upserted: written, koooraFallbackChannels: 0, enriched: null };
}

export async function syncMatchesFromSource({ dryRunMode = dryRun } = {}) {
  const uniqueRows = await collectMatchRowsFromSource();

  if (dryRunMode) {
    for (const row of uniqueRows.slice(0, 10)) {
      console.log(`[dry-run] ${row.home_team} vs ${row.away_team} channel=${row.channel || "trusted_source_required"}`);
    }
    return { parsed: uniqueRows.length, upserted: 0, enriched: null };
  }

  return upsertMatchRows(uniqueRows);
}

async function main() {
  await syncMatchesFromSource({ dryRunMode: dryRun });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
