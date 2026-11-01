import { statfs, mkdir, cp, rename, symlink, readdir, rm, realpath, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const work = '/var/lib/korafabor-publish/work';
const state = '/var/lib/korafabor-publish';
const website = '/var/www/korafabor';
async function publicModes(directory) {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Unexpected publication symlink');
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) await publicModes(file); else await chmod(file, 0o644);
  }
}
if (process.cwd() !== work || process.getuid() === 0) throw Error('Use the isolated publisher service');
const require = createRequire(work + '/scripts/migrate-korafabor.cjs');
const disk = await statfs(website);
if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw Error('Publication deferred: disk reserve below 2 GiB');
const started = Date.now();
const resume = process.argv[2]?.match(/^--resume=(\d{13})$/)?.[1];
if (process.argv[2] && !resume) throw Error('Invalid publisher argument');
if (!resume) execFileSync('/usr/bin/node', [work + '/scripts/build-complete-site.cjs'], { cwd: work,
  env: process.env, stdio: 'inherit', timeout: 480000 });
const version = String(Date.now());
const nextState = `${state}/states/${resume || version}`;
let verified;
if (resume) {
  const { readFile, stat } = await import('node:fs/promises');
  if ((await readFile(`${work}/_site/CNAME`, 'utf8')).trim() !== 'korafabor.pro') throw Error('Staged migration incomplete');
  await stat(`${nextState}/archive/catalog.json`);
  const { versionFrontendModules } = require(work + '/scripts/migrate-korafabor.cjs');
  versionFrontendModules(`${work}/_site`);
  const { assertCompletePublication } = require(work + '/scripts/build-complete-site.cjs');
  const htmlPages = (await readdir(`${work}/_site`, { recursive: true })).filter(file => file.endsWith('.html')).length;
  verified = { ...assertCompletePublication(work, `${work}/_site`, { siteUrl: 'https://korafabor.pro' }),
    htmlPages, siteUrl: 'https://korafabor.pro' };
} else {
  await mkdir(`${nextState}/news`, { recursive: true, mode: 0o755 });
  await cp(`${work}/_site/archive`, `${nextState}/archive`, { recursive: true });
  await cp(`${work}/_site/news/catalog.json`, `${nextState}/news/catalog.json`);
  const { migrate } = require(work + '/scripts/migrate-korafabor.cjs');
  verified = migrate(`${work}/_site`, work);
}
await publicModes(`${work}/_site`);
await publicModes(nextState);
await mkdir(`${website}/releases`, { recursive: true, mode: 0o755 });
const release = `${website}/releases/${version}`;
// systemd exposes the work and web roots as separate writable mounts.
await cp(`${work}/_site`, release, { recursive: true });
for (const [target, pointer] of [[release, `${website}/current`], [nextState, `${state}/state-current`]]) {
  const temporary = pointer + '.' + process.pid;
  await symlink(target, temporary);
  await rename(temporary, pointer);
}
await writeFile(`${state}/last-publication.json`, JSON.stringify({ version, ...verified,
  completedAt: new Date().toISOString(), elapsedMs: Date.now() - started }), { mode: 0o600 });
for (const base of [`${website}/releases`, `${state}/states`]) {
  const versions = (await readdir(base)).filter(name => /^\d{13}$/.test(name)).sort().reverse();
  for (const old of versions.slice(3)) {
    const resolved = await realpath(`${base}/${old}`);
    if (resolved !== `${base}/${old}`) throw Error('Unsafe release cleanup path');
    await rm(resolved, { recursive: true });
  }
}
console.log(JSON.stringify({ event: 'korafabor_published', version, ...verified, elapsedMs: Date.now() - started }));
