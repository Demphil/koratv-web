import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { env, matchChannels, parseM3uText } from "./import-m3u.js";

const DEFAULT_TIMEOUT_MS = 90000;
const SPORTS_INCLUDE_RE = /\b(sport|sports|bein|ssc|arryadia|alkass|الكاس|الكأس|الرياضيه|الرياضية|on\s*time|on\s*sport|ad\s*sport|thmanyah|ثمانيه|ثمانية|starzplay|shahid|mbc\s*action|ksa\s*sport)\b/i;
const NON_SPORTS_RE = /\b(vod|movie|movies|film|films|cinema|series|serial|مسلسل|مسلسلات|افلام|أفلام|فيلم|kids|documentary|documentaries|music|news|playlist)\b/i;

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...details
  }));
}

function hashUrl(url) {
  return createHash("sha256").update(String(url || "")).digest("hex").slice(0, 12);
}

function providerHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function providerOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function rewriteProviderUrlOrigin(url, origin) {
  if (!origin || !url) return url;
  try {
    const target = new URL(url);
    const canonical = new URL(origin);
    target.protocol = canonical.protocol;
    target.host = canonical.host;
    return target.href;
  } catch {
    return url;
  }
}

function rewriteProviderEntryOrigins(entries, origin) {
  if (!origin) return entries;
  return entries.map((entry) => ({
    ...entry,
    url: rewriteProviderUrlOrigin(entry.url, origin)
  }));
}

function normalizeProviderHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `http://${raw.replace(/^\/+|\/+$/g, "")}`;
}

function xtreamM3uUrl(host, { username, password, type, output }) {
  const base = normalizeProviderHost(host);
  if (!base || !username || !password) return "";
  const url = new URL("/get.php", base);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  url.searchParams.set("type", type || "m3u_plus");
  url.searchParams.set("output", output || "m3u8");
  return url.href;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolveProviderUrls(options = {}) {
  const explicit = options.providerUrl || env("IPTV_PROVIDER_URL");
  const username = options.username || env("IPTV_PROVIDER_USERNAME") || env("IPTV_USERNAME") || env("XTREAM_USERNAME");
  const password = options.password || env("IPTV_PROVIDER_PASSWORD") || env("IPTV_PASSWORD") || env("XTREAM_PASSWORD");
  const type = options.type || env("IPTV_PROVIDER_TYPE", "m3u_plus");
  const output = options.output || env("IPTV_PROVIDER_OUTPUT", "m3u8");
  const hosts = [
    options.host,
    env("IPTV_PROVIDER_HOST"),
    env("IPTV_PROVIDER_DNS"),
    env("IPTV_DNS"),
    env("XTREAM_HOST"),
    env("XTREAM_DNS"),
    env("IPTV_PROVIDER_BACKUP_HOST"),
    env("IPTV_SAMSUNG_LG_DNS")
  ];
  return unique([
    explicit,
    ...hosts.map((host) => xtreamM3uUrl(host, { username, password, type, output }))
  ]);
}

function isSportsText(value) {
  const text = String(value || "").toLowerCase();
  return SPORTS_INCLUDE_RE.test(text) && !NON_SPORTS_RE.test(text);
}

function isSportsProviderEntry(entry) {
  return isSportsText(`${entry.name || ""} ${entry.rawName || ""} ${entry.group || ""}`);
}

function isSportsChannel(channel) {
  return isSportsText(channel.name);
}

function qualityFromText(value) {
  const text = String(value || "").toLowerCase();
  const normalized = text
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  if (/\b(?:2160p|4k|uhd)\b/.test(normalized)) return { label: "2160p", height: 2160, rank: 2160 };
  if (/\b(?:1080p|fhd|full\s*hd)\b/.test(normalized)) return { label: "1080p", height: 1080, rank: 1080 };
  if (/\b(?:720p|hd)\b/.test(normalized)) return { label: "720p", height: 720, rank: 720 };
  if (/\b(?:576p|sd)\b/.test(normalized)) return { label: "576p", height: 576, rank: 576 };
  if (/\b480p\b/.test(normalized)) return { label: "480p", height: 480, rank: 480 };
  if (/\b360p\b/.test(normalized)) return { label: "360p", height: 360, rank: 360 };
  return null;
}

function parseStreamInf(line) {
  const attrs = {};
  String(line || "").replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi, (_, key, value) => {
    attrs[key.toLowerCase()] = String(value || "").replace(/^"|"$/g, "");
    return "";
  });
  return attrs;
}

function qualityFromHeight(height) {
  const value = Number(height);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 2000) return { label: "2160p", height: 2160, rank: 2160 };
  if (value >= 1000) return { label: "1080p", height: 1080, rank: 1080 };
  if (value >= 700) return { label: "720p", height: 720, rank: 720 };
  if (value >= 560) return { label: "576p", height: 576, rank: 576 };
  if (value >= 450) return { label: "480p", height: 480, rank: 480 };
  if (value >= 320) return { label: "360p", height: 360, rank: 360 };
  return { label: `${Math.round(value)}p`, height: Math.round(value), rank: Math.round(value) };
}

function qualityFromStreamInf(attrs) {
  const height = String(attrs.resolution || "").match(/x(\d+)/i)?.[1];
  return qualityFromHeight(height)
    || qualityFromText(attrs.name)
    || qualityFromText(attrs.video)
    || null;
}

export function parseMasterPlaylistVariants(text, sourceUrl) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

    const attrs = parseStreamInf(line);
    const uri = lines[index + 1] && !lines[index + 1].startsWith("#") ? lines[index + 1] : "";
    const quality = qualityFromStreamInf(attrs);
    if (!uri || !quality) continue;

    variants.push({
      label: quality.label,
      height: quality.height,
      rank: Number(attrs.bandwidth || 0) || quality.rank,
      bandwidth: Number(attrs.bandwidth || 0) || null,
      url: new URL(uri, sourceUrl).href,
      sourceName: attrs.name || ""
    });
  }
  return variants.sort((a, b) => b.rank - a.rank);
}

function buildQualityVariants(item) {
  const candidates = item.candidates?.length ? item.candidates : [item];
  const byLabel = new Map();
  for (const candidate of candidates) {
    const quality = qualityFromText(`${candidate.source_name || ""} ${candidate.group || ""}`);
    if (!quality || !candidate.original_url) continue;
    const current = byLabel.get(quality.label);
    if (!current || quality.rank > current.rank) {
      byLabel.set(quality.label, {
        label: quality.label,
        height: quality.height,
        url: candidate.original_url,
        sourceName: candidate.source_name || item.source_name || "",
        rank: quality.rank
      });
    }
  }
  for (const variant of item.masterQualityVariants || []) {
    if (!variant.label || !variant.url) continue;
    const current = byLabel.get(variant.label);
    if (!current || Number(variant.rank || variant.height || 0) > current.rank) {
      byLabel.set(variant.label, {
        label: variant.label,
        height: variant.height,
        url: variant.url,
        sourceName: variant.sourceName || item.source_name || "",
        rank: Number(variant.rank || variant.height || 0)
      });
    }
  }

  return [...byLabel.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ label, height, url, sourceName }) => ({ label, height, url, sourceName }));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
        "user-agent": "koratvProviderSync/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function fetchProviderPlaylist(urls, timeoutMs) {
  const errors = [];
  for (const url of urls) {
    try {
      const text = await fetchWithTimeout(url, timeoutMs);
      return { url, text };
    } catch (error) {
      errors.push(`${providerHost(url)}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`All IPTV provider sources failed. ${errors.join(" | ")}`);
}

async function mapWithConcurrency(items, limit, worker) {
  const output = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

async function isWorkingHlsUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        "user-agent": process.env.IPTV_UPSTREAM_USER_AGENT || "VLC/3.0.20 LibVLC/3.0.20"
      }
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const text = await response.text();
    return text.trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function chooseWorkingProviderLinks(matched, { timeoutMs, concurrency, enabled }) {
  if (!enabled) return matched;
  const checked = await mapWithConcurrency(matched, concurrency, async (item) => {
    const candidates = item.candidates?.length ? item.candidates : [item];
    for (const candidate of candidates) {
      if (await isWorkingHlsUrl(candidate.original_url, timeoutMs)) {
        return {
          ...item,
          original_url: candidate.original_url,
          source_name: candidate.source_name || item.source_name,
          checked_candidates: candidates.indexOf(candidate) + 1
        };
      }
    }
    return null;
  });
  return checked.filter(Boolean);
}

async function enrichMasterQualityVariants(matched, { timeoutMs, concurrency, enabled }) {
  if (!enabled) return matched;
  return mapWithConcurrency(matched, concurrency, async (item) => {
    const candidates = item.candidates?.length ? item.candidates : [item];
    const byLabel = new Map();

    for (const candidate of candidates) {
      try {
        const text = await fetchWithTimeout(candidate.original_url, timeoutMs);
        const variants = parseMasterPlaylistVariants(text, candidate.original_url);
        for (const variant of variants) {
          const current = byLabel.get(variant.label);
          if (!current || Number(variant.rank || 0) > Number(current.rank || 0)) {
            byLabel.set(variant.label, {
              ...variant,
              sourceName: variant.sourceName || candidate.source_name || item.source_name || ""
            });
          }
        }
      } catch {
        // Many provider entries are already media playlists. Treat that as non-fatal.
      }
    }

    return {
      ...item,
      masterQualityVariants: [...byLabel.values()].sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0))
    };
  });
}

async function readExistingChannels(supabase) {
  const pageSize = 1000;
  const channels = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("channels")
      .select("id,name,original_url,active")
      .eq("active", true)
      .range(from, to);

    if (error) throw error;
    channels.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return channels;
}

function buildUpdatePayload(existingChannels, matched) {
  const byName = new Map(matched.map((item) => [item.name, item]));
  const updates = [];
  const unchanged = [];
  const missing = [];

  for (const channel of existingChannels) {
    const match = byName.get(channel.name);
    if (!match) {
      missing.push(channel.name);
      continue;
    }

    const qualityVariants = buildQualityVariants(match);

    if (match.original_url === channel.original_url && !qualityVariants.length) {
      unchanged.push(channel.name);
      continue;
    }

    updates.push({
      id: channel.id,
      name: channel.name,
      original_url: match.original_url,
      quality_variants: qualityVariants,
      active: true
    });
  }

  return { updates, unchanged, missing };
}

export async function syncIptvProvider(options = {}) {
  const providerUrls = resolveProviderUrls(options);
  const dryRun = Boolean(options.dryRun ?? process.argv.includes("--dry-run"));
  const timeoutMs = Number(options.timeoutMs || env("IPTV_PROVIDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS));
  const probeTimeoutMs = Number(options.probeTimeoutMs || env("IPTV_PROVIDER_PROBE_TIMEOUT_MS", 10000));
  const probeConcurrency = Number(options.probeConcurrency || env("IPTV_PROVIDER_PROBE_CONCURRENCY", 6));
  const masterProbeTimeoutMs = Number(options.masterProbeTimeoutMs || env("IPTV_MASTER_PROBE_TIMEOUT_MS", 8000));
  const masterProbeConcurrency = Number(options.masterProbeConcurrency || env("IPTV_MASTER_PROBE_CONCURRENCY", 4));
  const candidatesPerChannel = Number(options.candidatesPerChannel || env("IPTV_SYNC_CANDIDATES_PER_CHANNEL", 8));
  const validateStreams = String(options.validateStreams ?? env("IPTV_VALIDATE_STREAMS", "true")) !== "false";
  const detectMasterQualities = String(options.detectMasterQualities ?? env("IPTV_SYNC_MASTER_QUALITIES", "true")) !== "false";
  const deactivateMissing = String(options.deactivateMissing ?? env("IPTV_SYNC_DEACTIVATE_MISSING", "false")) === "true";
  const sportsOnly = String(options.sportsOnly ?? env("IPTV_SYNC_ONLY_SPORTS", "true")) !== "false";

  if (!providerUrls.length) {
    log("sync_skipped", { reason: "IPTV provider credentials are not set" });
    return { ok: false, skipped: true, reason: "missing_provider_url" };
  }

  const supabaseUrl = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for IPTV provider sync. NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are also accepted.");
  }

  const startedAt = Date.now();
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  log("sync_started", {
    providerHost: providerHost(providerUrls[0]),
    providerHash: hashUrl(providerUrls[0]),
    providerSources: providerUrls.length,
    dryRun
  });

  const [existingChannels, provider] = await Promise.all([
    withTimeout(readExistingChannels(supabase), timeoutMs, "Supabase channel read"),
    withTimeout(fetchProviderPlaylist(providerUrls, timeoutMs), timeoutMs, "Provider M3U fetch")
  ]);
  const m3uText = provider.text;
  log("provider_playlist_loaded", {
    providerHost: providerHost(provider.url),
    providerHash: hashUrl(provider.url),
    bytes: m3uText.length
  });

  const providerEntries = rewriteProviderEntryOrigins(parseM3uText(m3uText), providerOrigin(provider.url));
  const entries = sportsOnly ? providerEntries.filter(isSportsProviderEntry) : providerEntries;
  const targetChannels = sportsOnly ? existingChannels.filter(isSportsChannel) : existingChannels;
  const streamNames = targetChannels.map((channel) => channel.name);
  const rawMatched = matchChannels(streamNames, entries, { candidatesPerChannel });
  const workingMatched = await chooseWorkingProviderLinks(rawMatched, {
    timeoutMs: probeTimeoutMs,
    concurrency: probeConcurrency,
    enabled: validateStreams
  });
  const matched = await enrichMasterQualityVariants(workingMatched, {
    timeoutMs: masterProbeTimeoutMs,
    concurrency: masterProbeConcurrency,
    enabled: detectMasterQualities
  });
  const { updates, unchanged, missing } = buildUpdatePayload(targetChannels, matched);

  log("sync_plan", {
    existingChannels: existingChannels.length,
    targetChannels: targetChannels.length,
    providerEntries: providerEntries.length,
    providerSportsEntries: entries.length,
    matchedCandidates: rawMatched.length,
    matchedWorking: matched.length,
    updates: updates.length,
    unchanged: unchanged.length,
    missing: missing.length,
    sportsOnly,
    deactivateMissing,
    validateStreams,
    detectMasterQualities,
    candidatesPerChannel
  });

  if (!dryRun && updates.length > 0) {
    const { error } = await supabase
      .from("channels")
      .upsert(updates, { onConflict: "id" });

    if (error) {
      const missingQualityColumn = /quality_variants|column .* does not exist|schema cache/i.test(error.message || "");
      if (!missingQualityColumn) throw error;
      log("quality_variants_column_missing", {
        message: error.message,
        action: "retrying_channel_upsert_without_quality_variants"
      });
      const fallbackUpdates = updates.map(({ quality_variants, ...update }) => update);
      const { error: fallbackError } = await supabase
        .from("channels")
        .upsert(fallbackUpdates, { onConflict: "id" });
      if (fallbackError) throw fallbackError;
    }
  }

  if (!dryRun && deactivateMissing && missing.length > 0) {
    const ids = existingChannels
      .filter((channel) => missing.includes(channel.name))
      .map((channel) => channel.id);

    const { error } = await supabase
      .from("channels")
      .update({ active: false })
      .in("id", ids);

    if (error) throw error;
  }

  const result = {
    ok: true,
    dryRun,
    providerEntries: providerEntries.length,
    providerSportsEntries: entries.length,
    existingChannels: existingChannels.length,
    targetChannels: targetChannels.length,
    matchedCandidates: rawMatched.length,
    matchedWorking: matched.length,
    updated: dryRun ? 0 : updates.length,
    wouldUpdate: updates.length,
    unchanged: unchanged.length,
    missing: missing.length,
    durationMs: Date.now() - startedAt
  };

  log("sync_finished", result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncIptvProvider().catch((error) => {
    log("sync_failed", {
      message: error?.message || String(error),
      stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
    });
    process.exit(1);
  });
}
