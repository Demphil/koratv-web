import "../src/lib/loadEnv.js";
import cron from "node-cron";
import { refreshStreamingData } from "./refresh-streaming-data.js";

const schedule = process.env.DAILY_REFRESH_CRON || "59 23 * * *";
const timezone = process.env.DAILY_REFRESH_TIMEZONE || "Africa/Casablanca";
const runOnStart = process.env.DAILY_REFRESH_ON_START === "true";

let running = false;

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    schedule,
    timezone,
    ...details
  }));
}

async function runDailyRefresh(reason) {
  if (running) {
    log("daily_refresh_skipped", { reason, skippedReason: "previous_refresh_still_running" });
    return;
  }

  running = true;
  try {
    log("daily_refresh_started", { reason });
    const result = await refreshStreamingData();
    log("daily_refresh_finished", { reason, result });
  } catch (error) {
    log("daily_refresh_failed", {
      reason,
      message: error?.message || String(error),
      stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
    });
  } finally {
    running = false;
  }
}

if (!cron.validate(schedule)) {
  console.error(`Invalid DAILY_REFRESH_CRON expression: ${schedule}`);
  process.exit(1);
}

cron.schedule(schedule, () => {
  void runDailyRefresh("schedule");
}, { timezone });

log("daily_refresh_cron_started", { runOnStart });

if (runOnStart) {
  void runDailyRefresh("startup");
}
