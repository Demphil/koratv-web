import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { syncMatchesFromSource } from "./sync-matches-from-source.js";
import { syncIptvProvider } from "./sync-iptv-provider.js";

const dryRun = process.argv.includes("--dry-run");
const cleanAudit = process.argv.includes("--clean-audit");
const resetChannels = process.argv.includes("--reset-channels") || process.env.DAILY_REFRESH_RESET_CHANNELS === "true";

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    dryRun,
    ...details
  }));
}

async function deleteRows(supabase, { table, idColumn = "id", sentinel = "__koratv_keep_none__" }) {
  if (dryRun) {
    log("cleanup_skipped_dry_run", { table });
    return { table, deleted: 0 };
  }

  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .neq(idColumn, sentinel);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || "")) {
      log("cleanup_table_missing", { table, message: error.message });
      return { table, deleted: 0, missing: true };
    }
    throw error;
  }

  log("cleanup_table_done", { table, deleted: count || 0 });
  return { table, deleted: count || 0 };
}

export async function cleanSupabaseData() {
  log("cleanup_started");

  if (dryRun) {
    const tables = ["channel_language_alternatives", "live_matches", process.env.SUPABASE_MATCHES_TABLE || "matches"];
    if (resetChannels) tables.push("channels");
    log("cleanup_skipped_dry_run", { tables });
    return tables.map((table) => ({ table, deleted: 0, dryRun: true }));
  }

  const supabase = getSupabaseAdmin();

  const results = [];
  results.push(await deleteRows(supabase, { table: "channel_language_alternatives", idColumn: "id", sentinel: -1 }));
  results.push(await deleteRows(supabase, { table: "live_matches", idColumn: "id" }));
  results.push(await deleteRows(supabase, { table: process.env.SUPABASE_MATCHES_TABLE || "matches", idColumn: "id" }));
  if (resetChannels) {
    results.push(await deleteRows(supabase, { table: "channels", idColumn: "id", sentinel: "00000000-0000-0000-0000-000000000000" }));
  }
  if (cleanAudit) {
    results.push(await deleteRows(supabase, { table: "stream_access_audit", idColumn: "id", sentinel: -1 }));
  }

  log("cleanup_finished", { results });
  return results;
}

async function isWorkingHlsUrl(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
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

async function auditChannelLinks(limit = Number(process.env.MANUAL_REFRESH_AUDIT_LIMIT || 80)) {
  if (dryRun) {
    const result = { tested: 0, working: 0, failed: 0, skipped: true };
    log("channel_link_audit_skipped_dry_run", result);
    return result;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("channels")
    .select("name,original_url,active,updated_at")
    .eq("active", true)
    .limit(limit);

  if (error) throw error;

  let working = 0;
  let failed = 0;
  for (const channel of data || []) {
    const ok = await isWorkingHlsUrl(channel.original_url);
    if (ok) working += 1;
    else failed += 1;
  }

  const result = { tested: data?.length || 0, working, failed };
  log("channel_link_audit_finished", result);
  return result;
}

export async function refreshStreamingData() {
  log("manual_refresh_started");
  await cleanSupabaseData();

  log("match_sync_started");
  const matches = await syncMatchesFromSource({ dryRunMode: dryRun });
  log("match_sync_finished", matches);

  log("iptv_sync_started");
  const iptv = await syncIptvProvider({ dryRun, validateStreams: true });
  log("iptv_sync_finished", iptv);

  const audit = await auditChannelLinks();
  log("manual_refresh_finished", { matches, iptv, audit });
  return { matches, iptv, audit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  refreshStreamingData().catch((error) => {
    log("manual_refresh_failed", {
      message: error?.message || String(error),
      stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
    });
    process.exit(1);
  });
}
