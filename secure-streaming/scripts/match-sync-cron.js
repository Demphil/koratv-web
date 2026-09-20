import cron from "node-cron";
import { syncMatchesFromSource } from "./sync-matches-from-source.js";

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
    log("match_sync_finished", { reason, ...result });
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

log("match_sync_cron_started", { schedule, timezone, runOnStart });

if (runOnStart) {
  void runSync("startup");
}
