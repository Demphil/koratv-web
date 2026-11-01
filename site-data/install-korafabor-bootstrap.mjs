import { stat, copyFile, symlink, mkdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.getuid() !== 0) throw Error('Root required on Njalla');
const target = '/etc/nginx/sites-available/korafabor';
const enabled = '/etc/nginx/sites-enabled/korafabor';
if (await stat(target).catch(() => null)) throw Error('Existing domain configuration; refusing to overwrite');
await mkdir('/var/www/certbot', { recursive: true, mode: 0o755 });
await copyFile('/opt/koratv/site-data/korafabor-bootstrap.conf', target);
await symlink(target, enabled);
try { execFileSync('nginx', ['-t'], { stdio: 'pipe' }); }
catch (error) { await unlink(enabled); throw error; }
execFileSync('systemctl', ['reload', 'nginx'], { stdio: 'pipe' });
console.log(JSON.stringify({ bootstrapReady: true, temporaryStatus: 503, videoRestarted: false }));
