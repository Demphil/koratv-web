import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const catalogLock = process.env.PROVIDER_CATALOG_LOCK_PATH || '/etc/koratv/provider-catalog.lock';
const routeLock = process.env.DIRECT_MATCH_ROUTE_STATE_LOCK_PATH || '/etc/koratv/direct-match-route-state.lock';
const assignmentLock = process.env.MATCH_RESOURCE_ASSIGNMENT_LOCK_PATH || '/etc/koratv/match-resource-assignment.lock';

function runLocked(lock, script) {
  return new Promise((resolve) => {
    const child = spawn('flock', ['-n', '-E', '75', lock, process.execPath, '--env-file=.env', script],
      { cwd: process.cwd(), stdio: 'inherit' });
    child.on('error', () => {
      console.error(`${script} could not start`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export function createProviderSyncScheduler({ run = runLocked, now = Date.now, env = process.env, log = console.error } = {}) {
  const catalogInterval = Math.max(15 * 60_000, Number(env.PROVIDER_POOL_SYNC_INTERVAL_MS || 4 * 60 * 60_000));
  let running = false;
  let catalogRunning = false;
  let nextCatalogAt = 0;
  const refreshCatalog = async () => {
    catalogRunning = true;
    try {
      const code = await run(catalogLock, 'scripts/sync-provider-pool.js');
      nextCatalogAt = now() + (code === 0 ? catalogInterval : 5 * 60_000);
      if (code && code !== 75) log(`Catalog sync exited ${code}; existing catalog retained`);
    } catch(error) {
      nextCatalogAt = now() + 5 * 60_000;
      log(`Catalog sync failed: ${error.message}; existing catalog retained`);
    } finally {catalogRunning = false;}
  };
  return async function tick() {
    if (running) return false;
    running = true;
    try {
      if (!catalogRunning && now() >= nextCatalogAt) void refreshCatalog();
      const routeCode = await run(routeLock, 'scripts/maintenance-sync.js');
      if (routeCode) {
        if (routeCode !== 75) log(`Route state sync exited ${routeCode}; existing route state retained`);
        return false;
      }
      const assignmentCode = await run(assignmentLock, 'scripts/resource-assignment.js');
      if (assignmentCode && assignmentCode !== 75) log(`Resource assignment sync exited ${assignmentCode}; existing assignment state retained`);
      return assignmentCode === 0;
    } finally { running = false; }
  };
}

export function isSchedulerEntrypoint(modulePath, argvPath = process.argv[1], pm2Path = process.env.pm_exec_path) {
  return modulePath === argvPath || modulePath === pm2Path;
}

if (isSchedulerEntrypoint(fileURLToPath(import.meta.url))) {
  const sync = createProviderSyncScheduler();
  const intervalMs = Math.max(15_000, Number(process.env.MATCH_RESOURCE_SYNC_INTERVAL_MS || 60_000));
  const tick = () => sync().catch(error => console.error(`Resource sync failed: ${error.message}`));
  setInterval(tick, intervalMs);
  tick();
}
