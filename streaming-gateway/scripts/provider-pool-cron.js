import { spawn } from 'node:child_process';
let running = false;
async function sync() {
  if (running) return;
  running = true;
  const child = spawn(process.execPath, ['--env-file=.env', 'scripts/sync-provider-pool.js'], { cwd: process.cwd(), stdio: 'inherit' });
  child.on('error', () => { running = false; console.error('Catalog sync could not start'); });
  child.on('exit', code => { running = false; if (code) console.error(`Catalog sync exited ${code}; existing catalog retained`); });
}
setInterval(sync, 10 * 60_000);
