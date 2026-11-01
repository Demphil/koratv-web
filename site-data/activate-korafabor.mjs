import { readFile, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.getuid() !== 0) throw Error('Root required on Njalla');
const report = JSON.parse(await readFile('/var/lib/korafabor-publish/last-publication.json', 'utf8'));
if (report.siteUrl !== 'https://korafabor.pro' || report.htmlPages < 1000 || report.articles < 400
  || report.sitemapUrls < 1000) throw Error('Complete migrated publication required before activation');
await stat('/etc/letsencrypt/live/korafabor.pro/fullchain.pem');
execFileSync('chmod', ['-R', 'go-w', '/var/www/korafabor', '/var/lib/korafabor-publish'], { stdio: 'pipe' });
const live = '/etc/nginx/sites-available/korafabor';
const backup = `/etc/koratv-site-data/korafabor-bootstrap-${Date.now()}.conf`;
await copyFile(live, backup);
await copyFile('/opt/korafabor/korafabor-site.conf', live);
try { execFileSync('nginx', ['-t'], { stdio: 'pipe' }); }
catch (error) { await copyFile(backup, live); throw error; }
execFileSync('systemctl', ['reload', 'nginx'], { stdio: 'pipe' });
execFileSync('systemctl', ['enable', '--now', 'kora-static-publish.timer'], { stdio: 'pipe' });
console.log(JSON.stringify({ activated: true, backup, ...report, appOrVideoRestarted: false }));
