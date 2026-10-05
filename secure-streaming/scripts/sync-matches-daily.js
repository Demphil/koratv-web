import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { collectMatchRowsFromSource, upsertMatchRows } from "./sync-matches-from-source.js";
import { moroccoDateKey, pruneMatchData, runDailyRolloverCleanup } from "./prune-match-data.js";

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

export async function syncMatchesDaily({ collectRows = collectMatchRowsFromSource, upsertRows = upsertMatchRows,
  createClient = getSupabaseAdmin, cleanupDay = runDailyRolloverCleanup, pruneRows = pruneMatchData } = {}) {
  log("daily_matches_sync_started");
  const rows = await collectRows();
  const minParsed = Number(process.env.MATCH_SYNC_MIN_PARSED || 1);
  if (!dryRun && rows.length < minParsed) {
    throw new Error(`Refusing to clean matches because only ${rows.length} rows were parsed. Set MATCH_SYNC_MIN_PARSED lower only if this is expected.`);
  }

  let cleanup = { deleted: 0, dryRun: true };
  let matches;
  if (dryRun) {
    for (const row of rows.slice(0, 10)) {
      console.log(`[dry-run] ${row.home_team} vs ${row.away_team} channel=${row.channel || "trusted_source_required"}`);
    }
    matches = { parsed: rows.length, upserted: 0, enriched: null };
  } else {
    const supabase = createClient();
    // Persist the replacement first; a failed refresh must not empty the next day.
    matches = await upsertRows(rows, { prune: false });
    const rollover = process.env.MATCH_DAILY_ROLLOVER_CLEANUP === "false"
      ? { skipped: true }
      : await cleanupDay(supabase, matchesTable, { dateKey: moroccoDateKey() });
    cleanup = { rollover, deleted: await pruneRows(supabase, matchesTable) };
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
