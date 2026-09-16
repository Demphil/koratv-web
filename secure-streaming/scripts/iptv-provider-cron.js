import cron from "node-cron";
import { syncIptvProvider } from "./sync-iptv-provider.js";

const schedule = process.env.IPTV_PROVIDER_SYNC_CRON || "0 */6 * * *";
const timezone = process.env.IPTV_PROVIDER_SYNC_TIMEZONE || "Africa/Casablanca";
const runOnStart = process.env.IPTV_PROVIDER_SYNC_ON_START === "true";

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
    log("cron_skipped", { reason: "previous_sync_still_running" });
    return;
  }

  running = true;
  try {
    await syncIptvProvider({ dryRun: false });
    log("cron_cycle_finished", { reason });
  } catch (error) {
    log("cron_cycle_failed", {
      reason,
      message: error?.message || String(error)
    });
  } finally {
    running = false;
  }
}

if (!cron.validate(schedule)) {
  console.error(`Invalid IPTV_PROVIDER_SYNC_CRON expression: ${schedule}`);
  process.exit(1);
}

cron.schedule(schedule, () => {
  void runSync("schedule");
}, { timezone });

log("cron_started", { schedule, timezone, runOnStart });

if (runOnStart) {
  void runSync("startup");
}
