import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { syncIptvProvider } from "./sync-iptv-provider.js";

const dryRun = process.argv.includes("--dry-run");

function envFlag(name, fallback) {
  return String(process.env[name] ?? fallback) === "true";
}

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    dryRun,
    ...details
  }));
}

export async function syncIptvLinks() {
  log("iptv_links_sync_started");
  const result = await syncIptvProvider({
    dryRun,
    validateStreams: envFlag("IPTV_VALIDATE_STREAMS", "false"),
    deactivateMissing: envFlag("IPTV_SYNC_DEACTIVATE_MISSING", "true"),
    sportsOnly: String(process.env.IPTV_SYNC_ONLY_SPORTS || "true") !== "false"
  });
  log("iptv_links_sync_finished", result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncIptvLinks().catch((error) => {
    log("iptv_links_sync_failed", {
      message: error?.message || String(error),
      stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
    });
    process.exit(1);
  });
}
