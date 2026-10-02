import { spawn } from 'node:child_process';
const catalogLock = process.env.PROVIDER_CATALOG_LOCK_PATH || '/etc/koratv/provider-catalog.lock';
const routeLock = process.env.DIRECT_MATCH_ROUTE_STATE_LOCK_PATH || '/etc/koratv/direct-match-route-state.lock';
const assignmentLock = process.env.MATCH_RESOURCE_ASSIGNMENT_LOCK_PATH || '/etc/koratv/match-resource-assignment.lock';
let running = false;

function runLocked(lock, script) {
  return new Promise((resolve) => {
    const child = spawn('flock', ['-n', '-E', '75', lock, process.execPath, '--env-file=.env', script],
      { cwd: process.cwd(), stdio: 'inherit' });
    child.on('error', () => {
      console.error(`${script} could not start`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

async function sync() {
  if (running) return;
  running = true;
  try {
    const catalogCode = await runLocked(catalogLock, 'scripts/sync-provider-pool.js');
    if (catalogCode && catalogCode !== 75) console.error(`Catalog sync exited ${catalogCode}; existing catalog retained`);
    const routeCode = await runLocked(routeLock, 'scripts/maintenance-sync.js');
    if (routeCode && routeCode !== 75) console.error(`Route state sync exited ${routeCode}; existing route state retained`);
    const assignmentCode = await runLocked(assignmentLock, 'scripts/resource-assignment.js');
    if (assignmentCode && assignmentCode !== 75) console.error(`Resource assignment sync exited ${assignmentCode}; existing assignment state retained`);
  } finally {
    running = false;
  }
}
setInterval(sync, 10 * 60_000);
sync();
