import "../src/lib/loadEnv.js";
import {
  resolveBroadcastChannelsBatchWithGemini,
  resolveBroadcastChannelsWithGemini
} from "../src/lib/geminiChannelResolver.js";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { fileURLToPath } from "node:url";

const cliDryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const tableArg = process.argv.find((arg) => arg.startsWith("--table="));
const defaultLimit = limitArg ? Number(limitArg.split("=")[1]) : 25;
const fallbackMatchTables = ["matches", "metascrape_matches", "media_qa_matches", "articles"];
const configuredMatchTables = (tableArg?.split("=")[1] || process.env.SUPABASE_MATCHES_TABLE || "")
  .split(",")
  .map((table) => table.trim())
  .filter(Boolean);
const matchesTables = [...new Set([...configuredMatchTables, ...fallbackMatchTables])];
const alternativesTable = process.env.SUPABASE_CHANNEL_ALTERNATIVES_TABLE || "channel_language_alternatives";
const geminiDelayMs = Number(process.env.GEMINI_REQUEST_DELAY_MS || 7000);
const arabicMinConfidence = Number(process.env.GEMINI_AR_CHANNEL_MIN_CONFIDENCE || 0.92);
const allowPerMatchFallback = process.env.GEMINI_PER_MATCH_FALLBACK === "true";
const autoApplyArabicChannels = process.env.GEMINI_AUTO_APPLY_AR_CHANNELS === "true";
const autoActivateLanguageAlternatives = process.env.GEMINI_AUTO_ACTIVATE_LANGUAGE_ALTERNATIVES === "true";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function expandChannelCandidates(candidates) {
  const expanded = [];
  for (const candidate of candidates.filter(Boolean)) {
    const value = String(candidate).trim();
    expanded.push(value);

    const beinNumber = value.match(/(?:بي\s*إن|بى\s*إن|bein|beIN|سبورت|sports?)\D*([0-9]+)/i)?.[1];
    if (/بي\s*إن|بى\s*إن|bein|beIN/i.test(value)) {
      expanded.push("beIN SPORTS");
      expanded.push("beIN SPORTS HD");
      if (beinNumber) {
        expanded.push(`beIN SPORTS HD ${beinNumber}`);
        expanded.push(`beIN Sports ${beinNumber} HD`);
        expanded.push(`beIN SPORTS ${beinNumber} HD`);
        expanded.push(`beIN SPORTS ${beinNumber}`);
        expanded.push(`بي إن سبورت ${beinNumber}`);
      }
    }

    const sscNumber = value.match(/(?:ssc|اس\s*اس\s*سي|إس\s*إس\s*سي)\D*([0-9]+)/i)?.[1];
    if (/ssc|اس\s*اس\s*سي|إس\s*إس\s*سي/i.test(value)) {
      expanded.push(`SSC ${sscNumber || "1"} HD`);
      expanded.push(`SSC SPORTS ${sscNumber || "1"} HD`);
      expanded.push(`SSC EXTRA ${sscNumber || "1"} HD`);
    }

    const onNumber = value.match(/(?:أون|اون|on|time|sport)\D*([0-9]+)/i)?.[1];
    if (/أون|اون|on\s*(time)?\s*sport/i.test(value)) {
      expanded.push(`ON TIME SPORTS ${onNumber || "1"}`);
      expanded.push(`ON SPORT ${onNumber || "1"}`);
      expanded.push(`ONTime Sports ${onNumber || "1"}`);
    }

    if (/الكاس|الكأس|alkass/i.test(value)) {
      expanded.push("Alkass One HD");
      expanded.push("Alkass Two HD");
      expanded.push("Alkass Sports");
    }

    if (/المغربية|الرياضية|arryadia/i.test(value)) {
      expanded.push("Arryadia TNT");
      expanded.push("Arryadia");
      expanded.push("الرياضية المغربية");
    }

    if (/شاهد|shahid/i.test(value)) {
      expanded.push("Shahid VIP");
      expanded.push("MBC Shahid");
    }
  }
  return uniq(expanded);
}

function matchPayload(row) {
  const text = [
    row.title,
    row.name,
    row.description,
    row.summary,
    row.content,
    row.body
  ].filter(Boolean).join(" ");
  const parsedTeams = parseTeamsFromText(text);

  return {
    id: row.id || row.match_id || row.slug,
    matchId: row.match_id || row.id || row.slug,
    homeTeam: row.home_team || row.homeTeam || row.team_home || row.home || row.home_name || parsedTeams.homeTeam,
    awayTeam: row.away_team || row.awayTeam || row.team_away || row.away || row.away_name || parsedTeams.awayTeam,
    league: row.league || row.competition || row.tournament || row.category || row.section,
    kickoff: row.kickoff_time || row.match_time || row.time || row.date || row.published_at || row.created_at,
    existingChannel: row.channel || row.channel_name || row.broadcast_channel || row.tv_channel || row.broadcaster,
    source: row.source || row.source_name || row.provider || "metascrape",
    rawText: text.slice(0, 2000)
  };
}

function parseTeamsFromText(text) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return {};

  const separators = [
    /\s+vs\.?\s+/i,
    /\s+v\s+/i,
    /\s+ضد\s+/i,
    /\s+مقابل\s+/i,
    /\s+[x×]\s+/i,
    /\s+-\s+/
  ];

  for (const separator of separators) {
    const parts = value.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        homeTeam: cleanTeamName(parts[0]),
        awayTeam: cleanTeamName(parts[1])
      };
    }
  }

  return {};
}

function cleanTeamName(value) {
  return String(value || "")
    .replace(/^(مباراة|مشاهدة|بث مباشر|live|watch)\s+/i, "")
    .replace(/\s+(اليوم|مباشر|live|online).*$/i, "")
    .trim();
}

function isMissingTable(error) {
  return error?.code === "PGRST205" || /could not find the table/i.test(error?.message || "");
}

async function loadMatches(supabase, limit = defaultLimit) {
  const errors = [];

  for (const table of matchesTables) {
    let query = supabase
      .from(table)
      .select("*")
      .limit(limit);

    if (table === "matches") {
      query = query.eq("active", true).order("kickoff_time", { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingTable(error)) {
        errors.push(`${table}: missing`);
        continue;
      }
      errors.push(`${table}: ${error.message}`);
      continue;
    }

    return { table, rows: data || [] };
  }

  throw new Error(`No readable match table found. Checked: ${errors.join("; ")}`);
}

async function readActiveChannels(supabase) {
  const { data, error } = await supabase
    .from("channels")
    .select("id,name,active")
    .eq("active", true);

  if (error) throw error;
  return (data || []).map((channel) => ({ ...channel, normalized: normalize(channel.name) }));
}

function findChannelByCandidate(channels, candidates) {
  const expandedCandidates = expandChannelCandidates(candidates);
  if (!expandedCandidates.length) return null;

  for (const candidate of expandedCandidates) {
    const normalizedCandidate = normalize(candidate);
    const exact = channels.find((channel) => channel.normalized === normalizedCandidate);
    if (exact) return exact;
    const partial = channels.find((channel) =>
      normalizedCandidate.length >= 4 &&
      (channel.normalized.includes(normalizedCandidate) || normalizedCandidate.includes(channel.normalized))
    );
    if (partial) return partial;
  }

  return null;
}

function hasEvidenceNotes(notes) {
  return /official|schedule|rights holder|tv guide|confirmed|source:/i.test(String(notes || ""));
}

async function updateMatchArabicChannel(supabase, { table, row, channelName, confidence, notes, dryRun }) {
  if (!channelName || table !== "matches") return;
  if (!autoApplyArabicChannels) return;
  if (confidence < arabicMinConfidence || !hasEvidenceNotes(notes)) return;

  const payload = {
    channel: channelName,
    payload: {
      ...(row.payload || {}),
      channelResolvedBy: "gemini",
      channelConfidence: confidence,
      channelNotes: notes,
      channelResolvedAt: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  };

  if (dryRun) {
    console.log("[dry-run] update match channel", row.match_id || row.id, channelName);
    return;
  }

  const query = supabase.from(table).update(payload);
  const { error } = row.match_id
    ? await query.eq("match_id", row.match_id)
    : await query.eq("id", row.id);

  if (error) throw error;
}

async function upsertAlternative(supabase, { baseChannelName, language, channelName, matchId, confidence, notes, dryRun }) {
  if (!baseChannelName || !channelName) return;
  const isVerifiedEnough = autoActivateLanguageAlternatives && confidence >= 0.92 && hasEvidenceNotes(notes);

  const payload = {
    base_channel_name: baseChannelName,
    language,
    channel_name: channelName,
    source: "gemini",
    match_id: matchId || null,
    confidence,
    notes,
    active: isVerifiedEnough,
    updated_at: new Date().toISOString()
  };

  if (dryRun) {
    console.log("[dry-run] upsert alternative", payload);
    return;
  }

  const { error } = await supabase
    .from(alternativesTable)
    .upsert(payload, { onConflict: matchId ? "match_id,language" : "base_channel_name,language" });

  if (error) throw error;
}

async function resolveWithRetry(match, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await resolveBroadcastChannelsWithGemini(match);
    } catch (error) {
      lastError = error;
      if (!String(error.message || "").includes("429") || attempt === attempts) break;
      const backoff = geminiDelayMs * attempt;
      console.log(`Gemini rate limit for ${match.id || "match"}; retrying in ${Math.round(backoff / 1000)}s.`);
      await wait(backoff);
    }
  }
  throw lastError;
}

export async function enrichMatchChannels({ rows, table = "matches", dryRun = cliDryRun, limit = defaultLimit } = {}) {
  const supabase = getSupabaseAdmin();
  const loaded = rows ? { table, rows } : await loadMatches(supabase, limit);
  const channels = await readActiveChannels(supabase);

  console.log(`Loaded ${loaded.rows.length} matches from ${loaded.table} for Gemini channel enrichment.`);
  const preparedMatches = loaded.rows
    .map((row) => ({ row, match: matchPayload(row) }))
    .filter(({ match }) => match.homeTeam && match.awayTeam);

  if (!preparedMatches.length) {
    console.log("No match rows were suitable for Gemini channel enrichment.");
    return { processed: 0, arabicUpdated: 0, alternativesUpdated: 0 };
  }

  let batchResults = new Map();
  let skipPerMatchFallback = false;
  try {
    batchResults = await resolveBroadcastChannelsBatchWithGemini(preparedMatches.map((item) => item.match));
  } catch (error) {
    skipPerMatchFallback = !allowPerMatchFallback && /429|503/.test(String(error.message || ""));
    const fallbackMessage = skipPerMatchFallback
      ? "Will retry on the next scheduled cycle to avoid exhausting Gemini quota."
      : "Falling back to per-match requests.";
    console.error(`Gemini batch failed: ${error.message}. ${fallbackMessage}`);
  }

  let arabicUpdated = 0;
  let alternativesUpdated = 0;

  for (const { row, match } of preparedMatches) {
    try {
      const resolved = batchResults.get(String(match.id || ""));
      if (!resolved && skipPerMatchFallback) continue;
      const finalResolved = resolved || await resolveWithRetry(match);
      const arCandidates = uniq(finalResolved.ar || []);
      const frCandidates = uniq(finalResolved.fr || []);
      const enCandidates = uniq(finalResolved.en || []);
      const arChannel = findChannelByCandidate(channels, arCandidates);
      const frChannel = findChannelByCandidate(channels, frCandidates);
      const enChannel = findChannelByCandidate(channels, enCandidates);
      const firstTrustedArabic = arChannel?.name || (finalResolved.confidence >= arabicMinConfidence ? arCandidates[0] : "");
      const baseChannelName = firstTrustedArabic || match.existingChannel || "";

      if (firstTrustedArabic) {
        await updateMatchArabicChannel(supabase, {
          table: loaded.table,
          row,
          channelName: firstTrustedArabic,
          confidence: finalResolved.confidence,
          notes: finalResolved.notes,
          dryRun
        });
        arabicUpdated += 1;
      }

      if (frChannel && baseChannelName) {
        await upsertAlternative(supabase, {
          baseChannelName,
          language: "fr",
          channelName: frChannel.name,
          matchId: match.matchId,
          confidence: finalResolved.confidence,
          notes: finalResolved.notes,
          dryRun
        });
        alternativesUpdated += 1;
      }

      if (enChannel && baseChannelName) {
        await upsertAlternative(supabase, {
          baseChannelName,
          language: "en",
          channelName: enChannel.name,
          matchId: match.matchId,
          confidence: finalResolved.confidence,
          notes: finalResolved.notes,
          dryRun
        });
        alternativesUpdated += 1;
      }

      console.log(
        `Processed ${match.homeTeam} vs ${match.awayTeam}: AR=${firstTrustedArabic || "-"} FR=${frChannel?.name || "-"} EN=${enChannel?.name || "-"} confidence=${finalResolved.confidence}`
      );

      if (!batchResults.size && geminiDelayMs > 0) await wait(geminiDelayMs);
    } catch (error) {
      console.error(`Failed match ${match.id || "unknown"}: ${error.message}`);
    }
  }

  return { processed: preparedMatches.length, arabicUpdated, alternativesUpdated };
}

async function main() {
  const result = await enrichMatchChannels({ dryRun: cliDryRun, limit: defaultLimit });
  console.log(`Gemini enrichment finished: processed=${result.processed}, arabicUpdated=${result.arabicUpdated}, alternativesUpdated=${result.alternativesUpdated}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
