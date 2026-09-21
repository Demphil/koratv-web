import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { collectMatchRowsFromSource, upsertMatchRows } from "./sync-matches-from-source.js";

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
  const rows = await collectMatchRowsFromSource();
  const minParsed = Number(process.env.MATCH_SYNC_MIN_PARSED || 1);
  if (!dryRun && rows.length < minParsed) {
    throw new Error(`Refusing to clean matches because only ${rows.length} rows were parsed. Set MATCH_SYNC_MIN_PARSED lower only if this is expected.`);
  }

  const supabase = getSupabaseAdmin();

  const cleanup = [];
  cleanup.push(await deleteRows(supabase, { table: "channel_language_alternatives", idColumn: "id", sentinel: -1 }));
  cleanup.push(await deleteRows(supabase, { table: "live_matches", idColumn: "id" }));
  cleanup.push(await deleteRows(supabase, { table: matchesTable, idColumn: "id" }));

  let matches;
  if (dryRun) {
    for (const row of rows.slice(0, 10)) {
      console.log(`[dry-run] ${row.home_team} vs ${row.away_team} channel=${row.channel || "trusted_source_required"}`);
    }
    matches = { parsed: rows.length, upserted: 0, enriched: null };
  } else {
    matches = await upsertMatchRows(rows);
  }
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
