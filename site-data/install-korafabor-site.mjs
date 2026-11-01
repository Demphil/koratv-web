import { mkdir, cp, symlink, stat, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const source = process.argv[2];
if (process.getuid() !== 0 || !source?.startsWith('/opt/korafabor-staging-')) throw Error('Root and scoped staged source required');
const run = (name, args, options = {}) => execFileSync(name, args, { stdio: 'pipe', timeout: 120000, ...options });
if (await stat('/opt/korafabor/korafabor-publish.mjs').catch(() => null)) throw Error('Publisher already installed');
try { run('id', ['kora-static-site']); throw Error('Publisher account already exists'); }
catch (error) { if (!error.status) throw error; }
run('useradd', ['--system', '--no-create-home', '--shell', '/usr/sbin/nologin', 'kora-static-site']);
const uid = Number(run('id', ['-u', 'kora-static-site']).toString().trim());
const gid = Number(run('id', ['-g', 'kora-static-site']).toString().trim());
await mkdir('/opt/korafabor', { recursive: true, mode: 0o755 });
await cp(`${source}/site-data/static-package.json`, '/opt/korafabor/package.json');
run('npm', ['install', '--prefix', '/opt/korafabor', '--ignore-scripts', '--no-audit', '--fund=false']);
for (const directory of ['/var/lib/korafabor-publish/work', '/var/lib/korafabor-publish/states', '/var/www/korafabor/releases']) {
  await mkdir(directory, { recursive: true, mode: 0o755 });
}
for (const directory of ['/var/lib/korafabor-publish', '/var/www/korafabor']) run('chown', ['-R', `${uid}:${gid}`, directory]);
const work = '/var/lib/korafabor-publish/work';
for (const item of await readdir(source)) {
  if (['site-data', 'seed'].includes(item)) continue;
  await cp(`${source}/${item}`, `${work}/${item}`, { recursive: true });
}
await symlink('/opt/korafabor/node_modules', `${work}/node_modules`);
await cp(`${source}/seed`, '/var/lib/korafabor-publish/states/0000000000000', { recursive: true });
await symlink('/var/lib/korafabor-publish/states/0000000000000', '/var/lib/korafabor-publish/state-current');
run('chown', ['-R', `${uid}:${gid}`, '/var/lib/korafabor-publish']);
run('chmod', ['-R', 'go-w', '/var/lib/korafabor-publish']);
await cp(`${source}/site-data/korafabor-publish.mjs`, '/opt/korafabor/korafabor-publish.mjs');
for (const file of ['kora-static-publish.service', 'kora-static-publish.timer', 'kora-static-publish.slice']) {
  await cp(`${source}/site-data/${file}`, `/etc/systemd/system/${file}`);
}
await cp(`${source}/site-data/korafabor-site.conf`, '/opt/korafabor/korafabor-site.conf');
run('systemctl', ['daemon-reload']);
console.log(JSON.stringify({ installed: true, source: work, activationPending: true, mediaRestarted: false }));
