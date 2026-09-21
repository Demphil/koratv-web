import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { syncMatchesFromSource } from "./sync-matches-from-source.js";

const dryRun = process.argv.includes("--dry-run");
const matchesTable = process.env.SUPABASE_MATCHES_TABLE || "matches";

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
    log("daily_matches_cleanup_skipped_dry_run", { table });
    return { table, deleted: 0, dryRun: true };
  }

  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .neq(idColumn, sentinel);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || "")) {
      log("daily_matches_cleanup_table_missing", { table, message: error.message });
      return { table, deleted: 0, missing: true };
    }
    throw error;
  }

  log("daily_matches_cleanup_table_done", { table, deleted: count || 0 });
  return { table, deleted: count || 0 };
}

export async function syncMatchesDaily() {
  log("daily_matches_sync_started");
  const supabase = getSupabaseAdmin();

  const cleanup = [];
  cleanup.push(await deleteRows(supabase, { table: "channel_language_alternatives", idColumn: "id", sentinel: -1 }));
  cleanup.push(await deleteRows(supabase, { table: "live_matches", idColumn: "id" }));
  cleanup.push(await deleteRows(supabase, { table: matchesTable, idColumn: "id" }));

  const matches = await syncMatchesFromSource({ dryRunMode: dryRun });
  const result = { cleanup, matches };
  log("daily_matches_sync_finished", result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncMatchesDaily().catch((error) => {
    log("daily_matches_sync_failed", {
      message: error?.message || String(error),
      stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
    });
    process.exit(1);
  });
}
