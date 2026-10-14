import cron from "node-cron";
import { syncMatchesFromSource, apiFootballUsage } from "./sync-matches-from-source.js";
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const schedule = process.env.MATCH_SYNC_CRON || "*/2 * * * *";
const timezone = process.env.MATCH_SYNC_TIMEZONE || "Africa/Casablanca";
const runOnStart = process.env.MATCH_SYNC_ON_START === "true";

let running = false;

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...details
  }));
}

async function runSync(reason) {
  if (running) {
    log("match_sync_skipped", { reason: "previous_sync_still_running" });
    return;
  }

  running = true;
  try {
    const result = await syncMatchesFromSource({ dryRunMode: false });
    log("match_sync_finished", { reason, ...result, apiFootball: apiFootballUsage() });
  } catch (error) {
    log("match_sync_failed", {
      reason,
      message: error?.message || String(error)
    });
  } finally {
    running = false;
  }
}

if (!cron.validate(schedule)) {
  console.error(`Invalid MATCH_SYNC_CRON expression: ${schedule}`);
  process.exit(1);
}

cron.schedule(schedule, () => {
  void runSync("schedule");
}, { timezone });

const codeVersion = createHash('sha256');
for (const path of ['./sync-matches-from-source.js', '../../shared/league-whitelist.mjs', '../../shared/match-visibility.mjs']) codeVersion.update(readFileSync(new URL(path, import.meta.url)));
log("match_sync_cron_started", { schedule, timezone, runOnStart, codeVersion: codeVersion.digest('hex').slice(0, 16) });

if (runOnStart) {
  void runSync("startup");
}
