import { readFile, writeFile, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const baseline = process.argv[2];
if (!/^[a-f0-9]{7,40}$/.test(baseline || '')) throw new Error('specify_baseline_revision');
const files = ['shared/match-broadcasts.mjs', ...['app.js', 'config.js', 'automatic-channel-repair.js', 'operator-console.js',
  'operator-channel.js', 'provider-pool.js', 'operator/console.js', 'content-ocr.js', 'match-content.js', 'match-content-repair.js',
  'content-activation.js', 'scripts/content-ocr.py', 'scripts/activate-content-verification.mjs', 'package.json',
  'deploy/content-ocr-requirements.txt', 'deploy/CONTENT-VERIFICATION.md'].map(path => `streaming-gateway/${path}`)];
const local = join(root, '.local'); await mkdir(local, { recursive: true });
const staged = await mkdtemp(join(local, 'content-release-'));
const manifest = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: {}, baseline: {} };
for (const path of files) {
  const data = await readFile(join(root, path));
  manifest.files[path] = createHash('sha256').update(data).digest('hex');
  try { manifest.baseline[path] = createHash('sha256').update(execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n')).digest('hex'); }
  catch { manifest.baseline[path] = null; }
  const target = join(staged, path); await mkdir(dirname(target), { recursive: true }); await copyFile(join(root, path), target);
}
await writeFile(join(staged, 'content-release.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ staged, revision: manifest.revision, files: files.length }));
