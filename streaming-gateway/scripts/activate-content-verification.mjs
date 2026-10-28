import { readFile, writeFile, mkdir, copyFile, access, unlink } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assessContentActivation } from '../content-activation.js';

const execute = promisify(execFile);
const runtime = '/opt/koratv/current';
const release = resolve(process.argv[2] || '');
const activate = process.argv.includes('--activate-when-idle');
if (!release.startsWith('/opt/koratv/staging/')) throw new Error('invalid_release_root');
const manifest = JSON.parse(await readFile(join(release, 'content-release.json'), 'utf8'));
const health = async () => (await fetch('http://127.0.0.1:3100/healthz', { signal: AbortSignal.timeout(5000) })).json();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const receiptPath = join(release, 'activation-receipt.json');
try {
  const previous = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (previous.status === 'active' && (await health()).contentVerification?.enabled) {
    console.log(JSON.stringify({ status: 'already_active', revision: manifest.revision })); process.exit(0);
  }
} catch {}
const first = assessContentActivation(await health());
if (!activate || !first.safe) {
  console.log(JSON.stringify({ status: first.safe ? 'idle_dry_run' : 'deferred', ...first, revision: manifest.revision })); process.exit(0);
}
// Require a full quiet minute, not one transient sample between viewer heartbeats.
for (let index = 0; index < 3; index++) {
  await wait(20_000);
  const assessment = assessContentActivation(await health());
  if (!assessment.safe) { console.log(JSON.stringify({ status: 'deferred', ...assessment })); process.exit(0); }
}
const files = Object.entries(manifest.files || {});
if (!files.length || files.length > 24) throw new Error('invalid_release_manifest');
for (const [path, hash] of files) {
  if (!/^(streaming-gateway|shared)\/[a-zA-Z0-9/_.-]+$/.test(path) || path.split('/').includes('..')) throw new Error('invalid_release_file');
  const bytes = await readFile(join(release, path));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('release_hash_mismatch');
  const targets = [join(runtime, path), ...(path.startsWith('shared/') ? [join('/home/ubuntu/iptv-system', path)] : [])];
  for (const target of targets) {
    let value = null;
    try { value = createHash('sha256').update((await readFile(target, 'utf8')).replace(/\r\n/g, '\n')).digest('hex'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (value !== manifest.baseline?.[path]) throw new Error('runtime_changed_since_staging');
  }
}
const backup = `/opt/koratv/backups/content-${Date.now()}`;
await mkdir(backup, { recursive: true, mode: 0o700 });
const envPath = join(runtime, 'streaming-gateway/.env');
const oldEnv = await readFile(envPath, 'utf8');
await writeFile(join(backup, 'gateway.env'), oldEnv, { mode: 0o600 });
const restored = [];
const targets = files.flatMap(([path]) => [{ source: join(release, path), target: join(runtime, path) },
  ...(path.startsWith('shared/') ? [{ source: join(release, path), target: join('/home/ubuntu/iptv-system', path) }] : [])]);
let restarted = false;
const rollback = async () => {
  for (const row of [...restored].reverse()) {
    if (row.existed) await copyFile(row.backup, row.target);
    else await unlink(row.target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await writeFile(envPath, oldEnv, { mode: 0o600 });
  if (restarted) await execute('pm2', ['restart', 'koratv-oracle-watch', '--update-env'], { env: { ...process.env, STREAM_CONTENT_VERIFICATION_ENABLED: parseEnv(oldEnv).STREAM_CONTENT_VERIFICATION_ENABLED || 'false' } });
};
try {
  for (const row of targets) {
    const saved = join(backup, relative('/', row.target));
    await mkdir(dirname(saved), { recursive: true, mode: 0o700 });
    let existed = true;
    try { await access(row.target); await copyFile(row.target, saved); } catch (error) { if (error.code !== 'ENOENT') throw error; existed = false; }
    restored.push({ ...row, existed, backup: saved });
    await mkdir(dirname(row.target), { recursive: true }); await copyFile(row.source, row.target);
  }
  const nextEnv = `${oldEnv.trimEnd()}\nSTREAM_CONTENT_VERIFICATION_ENABLED=true\n`;
  if (parseEnv(nextEnv).STREAM_CONTENT_VERIFICATION_ENABLED !== 'true') throw new Error('invalid_activation_config');
  await writeFile(envPath, nextEnv, { mode: 0o600 });
  const final = assessContentActivation(await health());
  if (!final.safe) { await rollback(); console.log(JSON.stringify({ status: 'deferred', ...final })); process.exit(0); }
  restarted = true;
  const restartAt = Date.now();
  await execute('pm2', ['restart', 'koratv-oracle-watch', '--update-env'], { env: { ...process.env, STREAM_CONTENT_VERIFICATION_ENABLED: 'true' } });
  let after, recovered = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    await wait(1000);
    try { after = await health(); if (after.status === 'ok' && after.contentVerification?.enabled
      && (!after.providerPrewarm?.enabled || !after.providerPrewarm.running && Date.parse(after.providerPrewarm.lastRunAt) >= restartAt)) { recovered = true; break; } } catch {}
  }
  if (!recovered) throw new Error('activation_health_failed');
  const receipt = { status: 'active', revision: manifest.revision, activatedAt: new Date().toISOString(), backup,
    contentVerification: after.contentVerification, prewarm: { warmed: after.providerPrewarm?.warmed, failed: after.providerPrewarm?.failed } };
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  console.log(JSON.stringify(receipt));
} catch {
  await rollback();
  console.log(JSON.stringify({ status: 'rolled_back', revision: manifest.revision, backup })); process.exitCode = 1;
}
