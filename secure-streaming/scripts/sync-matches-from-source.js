import "../src/lib/loadEnv.js";
import * as cheerio from "cheerio";
import { fileURLToPath } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { isAllowedMatch, normalizeTeamName } from "../../shared/league-whitelist.mjs";

const BASE_SITE_URL = process.env.MATCH_SOURCE_URL || "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D8%A8%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D9%8A%D9%88%D9%85";
const FIXTURES_SITE_URL = "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D9%88%D8%A7%D8%B9%D9%8A%D8%AF-%D8%A7%D9%84%D9%85%D8%A8%D8%A7%D8%B1%D9%8A%D8%A7%D8%AA";
const matchesTable = process.env.SUPABASE_MATCHES_TABLE || "matches";
const dryRun = process.argv.includes("--dry-run");
const enrichAfterSync = process.env.GEMINI_ENRICH_AFTER_MATCH_SYNC === "true";
const apiFootballKey = process.env.API_FOOTBALL_KEY
  || process.env.APIFOOTBALL_KEY
  || process.env.FOOTBALL_API_KEY
  || process.env.RAPIDAPI_KEY
  || "";
const apiFootballBaseUrl = (process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/+$/, "");
const apiFootballDetailLimit = Number(process.env.API_FOOTBALL_DETAIL_LIMIT || 16);

const KOOORA_LEAGUE_CHANNEL_FALLBACKS = [
  { pattern: /الدوري الانجليزي الممتاز|premier league/i, channels: ["beIN SPORTS HD 2", "beIN SPORTS HD 1"] },
  { pattern: /الدوري الاسباني|la ?liga/i, channels: ["beIN SPORTS HD 3", "beIN SPORTS Mena 3", "beIN SPORTS HD 4"] },
  { pattern: /الدوري الفرنسي|ligue 1/i, channels: ["beIN SPORTS HD 1", "beIN SPORTS HD 5"] },
  { pattern: /الدوري الالماني|bundesliga/i, channels: ["beIN SPORTS HD 5", "beIN SPORTS HD 7"] },
  { pattern: /الدوري الايطالي|serie a/i, channels: ["beIN SPORTS HD 4", "beIN SPORTS HD 1"] },
  { pattern: /دوري ابطال اوروبا|champions league/i, channels: ["beIN SPORTS HD 1", "beIN SPORTS HD 2", "beIN SPORTS HD 3"] },
  { pattern: /الدوري الاوروبي|europa league/i, channels: ["beIN SPORTS HD 1", "beIN SPORTS HD 2"] },
  { pattern: /دوري المؤتمر الاوروبي|conference league/i, channels: ["beIN SPORTS HD 3", "beIN SPORTS HD 4"] },
  { pattern: /كاس السوبر الاوروبي|european super cup/i, channels: ["beIN SPORTS HD 1"] },
  { pattern: /دوري الامم الاوروبيه|nations league/i, channels: ["beIN SPORTS HD 1", "beIN SPORTS HD 2"] },
  { pattern: /بطوله امم اوروبا|uefa euro|كاس امم افريقيا|afcon/i, channels: ["beIN SPORTS MAX 1", "beIN SPORTS MAX 2", "beIN SPORTS HD 1"] },
  { pattern: /دوري ابطال افريقيا|كاس الكونف|كاس السوبر الافريقي|بطوله امم افريقيا للمحليين/i, channels: ["beIN SPORTS HD 6", "beIN SPORTS HD 7", "beIN SPORTS HD 1"] },
  { pattern: /الدوري المصري الممتاز/i, channels: ["On Time Sports 1", "ON TIME SPORTS 2", "أون سبورت 1"] },
  { pattern: /البطوله الوطنيه الاحترافيه المغربيه|البطولة الوطنية الاحترافية المغربية|الدوري المغربي|botola/i, channels: ["الرياضية المغربية", "Arryadia TNT", "الرياضية المغربية 1"] },
  { pattern: /الرابطه التونسيه المحترفه الاولي|الرابطة التونسية المحترفة الأولى/i, channels: ["beIN SPORTS HD 6", "beIN SPORTS HD 7"] },
  { pattern: /الرابطه الجزائريه المحترفه الاولي|الرابطة الجزائرية المحترفة الأولى/i, channels: ["beIN SPORTS HD 6", "beIN SPORTS HD 7"] },
  { pattern: /دوري روشن السعودي|saudi pro/i, channels: ["ثمانية 1", "ثمانية 2", "ثمانية 3"] },
];

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
  const liveCodes = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
  const finishedCodes = new Set(["FT", "AET", "PEN"]);
  return {
    raw: short || String(status.long || "FIXTURE").toUpperCase(),
    isLive: liveCodes.has(short),
    isFinished: finishedCodes.has(short),
    liveMinute: Number.isFinite(elapsed) ? elapsed : null
  };
}

function apiFootballScore(fixture = {}) {
  const home = fixture?.goals?.home;
  const away = fixture?.goals?.away;
  return Number.isFinite(Number(home)) && Number.isFinite(Number(away)) ? `${home} - ${away}` : "VS";
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

async function collectApiFootballRows() {
  const dates = [moroccoDateParts(0), moroccoDateParts(1)];
  const rows = [];
  const detailTargets = [];

  for (const date of dates) {
    const fixtures = await fetchApiFootball("/fixtures", { date, timezone: "Africa/Casablanca" });
    for (const fixture of fixtures) {
      const homeTeam = fixture?.teams?.home?.name?.trim();
      const awayTeam = fixture?.teams?.away?.name?.trim();
      const league = fixture?.league?.name || "";
      const kickoff = fixture?.fixture?.date;
      if (!homeTeam || !awayTeam || !kickoff) continue;
      if (!isAllowedMatch({ league, homeTeam, awayTeam })) continue;

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
          goals: [],
          yellowCards: null,
          redCards: null,
          time: new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Casablanca", hourCycle: "h23", hour: "2-digit", minute: "2-digit"
          }).format(new Date(kickoff)),
          homeLogo: fixture?.teams?.home?.logo || "",
          awayLogo: fixture?.teams?.away?.logo || "",
          sourceFixtureId: fixture?.fixture?.id || "",
          channelSource: "trusted_source_required",
          dataSource: "api-football"
        },
        updated_at: new Date().toISOString()
      };
      rows.push(row);
      if ((status.isLive || status.isFinished) && detailTargets.length < apiFootballDetailLimit) {
        detailTargets.push({ fixtureId: fixture?.fixture?.id, row });
      }
    }
  }

  for (const target of detailTargets) {
    if (!target.fixtureId) continue;
    try {
      const events = await fetchApiFootball("/fixtures/events", { fixture: target.fixtureId });
      const normalized = apiFootballEvents(events, target.row.home_team, target.row.away_team);
      target.row.payload = {
        ...target.row.payload,
        goals: normalized.goals,
        yellowCards: normalized.yellowCards,
        redCards: normalized.redCards,
        eventDetailsLoaded: true
      };
    } catch (error) {
      console.warn(`API-Football events failed for ${target.fixtureId}: ${error.message}`);
    }
  }

  console.log(`Parsed ${rows.length} matches from API-Football (${dates.join(", ")}).`);
  return rows;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
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

function pickExistingChannel(channelNames, candidates) {
  const normalized = channelNames.map((name) => ({ name, key: normalizeLookup(name) }));
  for (const candidate of candidates) {
    const key = normalizeLookup(candidate);
    const exact = normalized.find((channel) => channel.key === key);
    if (exact) return exact.name;
    const partial = normalized.find((channel) => key.length >= 5 && (channel.key.includes(key) || key.includes(channel.key)));
    if (partial) return partial.name;
  }
  return "";
}

async function readActiveChannelNames(supabase) {
  const { data, error } = await supabase
    .from("channels")
    .select("name,active")
    .eq("active", true);
  if (error) {
    console.warn(`Could not read active channels before Kooora fallback mapping: ${error.message}`);
    return [];
  }
  return (data || []).map((channel) => channel.name).filter(Boolean);
}

async function applyKoooraChannelFallbacks(supabase, rows) {
  const channelNames = await readActiveChannelNames(supabase);
  if (!channelNames.length) return { rows, updated: 0 };

  let updated = 0;
  const output = rows.map((row) => {
    if (row.channel) return row;
    const league = normalizeLookup(row.league);
    const rule = KOOORA_LEAGUE_CHANNEL_FALLBACKS.find((item) => item.pattern.test(league));
    const channel = rule ? pickExistingChannel(channelNames, rule.channels) : "";
    if (!channel) return row;
    updated += 1;
    return {
      ...row,
      channel,
      payload: {
        ...(row.payload || {}),
        channel,
        channelResolvedBy: "kooora-league-fallback",
        channelConfidence: 0.7,
        channelNotes: "Kooora did not expose tvChannels for this match; selected the configured IPTV channel fallback for this Kooora league.",
        channelResolvedAt: new Date().toISOString()
      }
    };
  });

  return { rows: output, updated };
}

function parseKoooraMatches(html) {
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
      const channelNames = (match.tvChannels || []).map((channel) => channel?.name).filter(Boolean);
      const preferredChannel = normalizeKoooraChannel(
        channelNames.find((name) => /beIN Sports Mena/i.test(name)) || channelNames[0]
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
          isLive: status === 'LIVE',
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
          matchLink: match?.link?.slug ? `https://www.kooora.com/${match.link.slug}/${match.id}` : '',
          channelSource: 'kooora-live-scores'
        },
        updated_at: new Date().toISOString()
      });
    }
  }

  return rows;
}

async function mergeExistingChannels(supabase, rows) {
  const matchIds = rows.map((row) => row.match_id).filter(Boolean);
  if (!matchIds.length) return rows;

  const { data, error } = await supabase
    .from(matchesTable)
    .select("match_id,channel,payload")
    .in("match_id", matchIds);

  if (error) {
    console.warn(`Could not read existing match channels before upsert: ${error.message}`);
    return rows;
  }

  const existingByMatchId = new Map((data || []).map((row) => [row.match_id, row]));
  return rows.map((row) => {
    const existing = existingByMatchId.get(row.match_id);
    if (!existing?.channel) return row;
    return {
      ...row,
      channel: existing.channel,
      payload: {
        ...(existing.payload || {}),
        ...(row.payload || {}),
        previousChannelPreserved: true
      }
    };
  });
}

export async function collectMatchRowsFromSource() {
  if (apiFootballEnabled()) {
    try {
      const apiRows = await collectApiFootballRows();
      if (apiRows.length) return [...new Map(apiRows.map((row) => [`${String(row.kickoff_time || '').slice(0, 10)}:${row.match_id}`, row])).values()];
      console.warn("API-Football returned no allowed matches; falling back to Kooora source.");
    } catch (error) {
      console.error(`API-Football source failed: ${error.message}; falling back to Kooora source.`);
    }
  }

  const tomorrowDate = moroccoDateParts(1);
  const pages = [
    { url: BASE_SITE_URL, dayOffset: 0 },
    { url: fixturesUrlForDate(tomorrowDate), dayOffset: 1 },
  ];
  const rows = [];

  for (const page of pages) {
    try {
      const html = await fetchHtml(page.url);
      rows.push(...parseMatches(html, page.dayOffset));
    } catch (error) {
      console.error(`Failed source ${page.url}: ${error.message}`);
    }
  }

  const uniqueRows = [...new Map(rows.map((row) => [`${String(row.kickoff_time || '').slice(0, 10)}:${row.match_id}`, row])).values()];
  console.log(`Parsed ${uniqueRows.length} matches from ${pages.map((page) => page.url).join(', ')}.`);
  return uniqueRows;
}

export async function upsertMatchRows(rows) {
  const supabase = getSupabaseAdmin();
  const rowsForUpsert = await mergeExistingChannels(supabase, rows);
  const fallbackResult = await applyKoooraChannelFallbacks(supabase, rowsForUpsert);
  const finalRowsForUpsert = fallbackResult.rows;
  if (fallbackResult.updated) {
    console.log(`Kooora league fallbacks filled ${fallbackResult.updated} match channels.`);
  }

  const { error } = await supabase
    .from(matchesTable)
    .upsert(finalRowsForUpsert, { onConflict: "match_id" });

  if (error) throw error;
  console.log(`Upserted ${finalRowsForUpsert.length} matches into ${matchesTable}.`);

  let enrichmentResult = null;
  if (enrichAfterSync) {
    try {
      const { enrichMatchChannels } = await import("./enrich-match-language-channels.js");
      enrichmentResult = await enrichMatchChannels({ rows: finalRowsForUpsert, table: matchesTable, dryRun: false });
      console.log(`Gemini post-sync enrichment: processed=${enrichmentResult.processed}, arabicUpdated=${enrichmentResult.arabicUpdated}, alternativesUpdated=${enrichmentResult.alternativesUpdated}.`);
    } catch (error) {
      console.error(`Gemini post-sync enrichment failed without aborting match sync: ${error.message}`);
    }
  }

  return { parsed: rows.length, upserted: finalRowsForUpsert.length, koooraFallbackChannels: fallbackResult.updated, enriched: enrichmentResult };
}

export async function syncMatchesFromSource({ dryRunMode = dryRun } = {}) {
  const uniqueRows = await collectMatchRowsFromSource();

  if (dryRunMode || !uniqueRows.length) {
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
