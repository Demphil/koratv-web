import "../src/lib/loadEnv.js";
import * as cheerio from "cheerio";
import { fileURLToPath } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { enrichMatchChannels } from "./enrich-match-language-channels.js";
import { applyTrustedBroadcastChannels } from "./trusted-broadcast-sources.js";

const BASE_SITE_URL = process.env.MATCH_SOURCE_URL || "https://jsportlive.com";
const matchesTable = process.env.SUPABASE_MATCHES_TABLE || "matches";
const dryRun = process.argv.includes("--dry-run");
const enrichAfterSync = process.env.GEMINI_ENRICH_AFTER_MATCH_SYNC !== "false";

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

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 KoraLive metascrape/1.0",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

function parseMatches(html, dayOffset) {
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
    const commentator = infoItems[1] || "";
    const matchId = `${slugify(homeTeam)}_vs_${slugify(awayTeam)}`;

    rows.push({
      id: `${date}_${matchId}`,
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

export async function syncMatchesFromSource({ dryRunMode = dryRun } = {}) {
  const pages = [
    { url: `${BASE_SITE_URL}/`, dayOffset: 0 },
    { url: `${BASE_SITE_URL}/matches-tomorrow/`, dayOffset: 1 }
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

  const uniqueRows = [...new Map(rows.map((row) => [row.match_id, row])).values()];
  console.log(`Parsed ${uniqueRows.length} matches from ${BASE_SITE_URL}.`);

  if (dryRunMode || !uniqueRows.length) {
    for (const row of uniqueRows.slice(0, 10)) {
      console.log(`[dry-run] ${row.home_team} vs ${row.away_team} channel=${row.channel || "trusted_source_required"}`);
    }
    return { parsed: uniqueRows.length, upserted: 0, enriched: null };
  }

  const supabase = getSupabaseAdmin();
  const rowsForUpsert = await mergeExistingChannels(supabase, uniqueRows);
  const trustedResult = await applyTrustedBroadcastChannels(supabase, rowsForUpsert);
  const finalRowsForUpsert = trustedResult.rows;
  if (trustedResult.updated) {
    console.log(`Trusted broadcast sources filled ${trustedResult.updated} match channels.`);
  }

  const { error } = await supabase
    .from(matchesTable)
    .upsert(finalRowsForUpsert, { onConflict: "match_id" });

  if (error) throw error;
  console.log(`Upserted ${finalRowsForUpsert.length} matches into ${matchesTable}.`);

  let enrichmentResult = null;
  if (enrichAfterSync) {
    try {
      enrichmentResult = await enrichMatchChannels({ rows: finalRowsForUpsert, table: matchesTable, dryRun: false });
      console.log(`Gemini post-sync enrichment: processed=${enrichmentResult.processed}, arabicUpdated=${enrichmentResult.arabicUpdated}, alternativesUpdated=${enrichmentResult.alternativesUpdated}.`);
    } catch (error) {
      console.error(`Gemini post-sync enrichment failed without aborting match sync: ${error.message}`);
    }
  }

  return { parsed: uniqueRows.length, upserted: finalRowsForUpsert.length, trustedChannels: trustedResult.updated, enriched: enrichmentResult };
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
