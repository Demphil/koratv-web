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

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
        "user-agent": "KoraLiveProviderSync/1.0"
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

    if (match.original_url === channel.original_url) {
      unchanged.push(channel.name);
      continue;
    }

    updates.push({
      id: channel.id,
      name: channel.name,
      original_url: match.original_url,
      active: true
    });
  }

  return { updates, unchanged, missing };
}

export async function syncIptvProvider(options = {}) {
  const providerUrl = options.providerUrl || env("IPTV_PROVIDER_URL");
  const dryRun = Boolean(options.dryRun ?? process.argv.includes("--dry-run"));
  const timeoutMs = Number(options.timeoutMs || env("IPTV_PROVIDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS));
  const deactivateMissing = String(options.deactivateMissing ?? env("IPTV_SYNC_DEACTIVATE_MISSING", "false")) === "true";
  const sportsOnly = String(options.sportsOnly ?? env("IPTV_SYNC_ONLY_SPORTS", "true")) !== "false";

  if (!providerUrl) {
    log("sync_skipped", { reason: "IPTV_PROVIDER_URL is not set" });
    return { ok: false, skipped: true, reason: "missing_provider_url" };
  }

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for IPTV provider sync.");
  }

  const startedAt = Date.now();
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  log("sync_started", {
    providerHost: providerHost(providerUrl),
    providerHash: hashUrl(providerUrl),
    dryRun
  });

  const [existingChannels, m3uText] = await Promise.all([
    withTimeout(readExistingChannels(supabase), timeoutMs, "Supabase channel read"),
    withTimeout(fetchWithTimeout(providerUrl, timeoutMs), timeoutMs, "Provider M3U fetch")
  ]);

  const providerEntries = parseM3uText(m3uText);
  const entries = sportsOnly ? providerEntries.filter(isSportsProviderEntry) : providerEntries;
  const targetChannels = sportsOnly ? existingChannels.filter(isSportsChannel) : existingChannels;
  const streamNames = targetChannels.map((channel) => channel.name);
  const matched = matchChannels(streamNames, entries);
  const { updates, unchanged, missing } = buildUpdatePayload(targetChannels, matched);

  log("sync_plan", {
    existingChannels: existingChannels.length,
    targetChannels: targetChannels.length,
    providerEntries: providerEntries.length,
    providerSportsEntries: entries.length,
    matched: matched.length,
    updates: updates.length,
    unchanged: unchanged.length,
    missing: missing.length,
    sportsOnly,
    deactivateMissing
  });

  if (!dryRun && updates.length > 0) {
    const { error } = await supabase
      .from("channels")
      .upsert(updates, { onConflict: "id" });

    if (error) throw error;
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
    matched: matched.length,
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
