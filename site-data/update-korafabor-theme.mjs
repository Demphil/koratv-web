import { readFile, writeFile, cp, rename, symlink, readdir, realpath, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const work = '/var/lib/korafabor-publish/work';
const website = '/var/www/korafabor';
const stage = process.argv[2];
if (process.getuid() === 0 || process.cwd() !== work || !/^\/opt\/korafabor-theme-\d{8}$/.test(stage || ''))
  throw Error('Use the isolated publisher user and scoped stage under the publication lock');
const require = createRequire(work + '/scripts/migrate-korafabor.cjs');
const { load } = require('cheerio');
const { assertCompletePublication } = require(work + '/scripts/build-complete-site.cjs');
const current = await realpath(website + '/current');
if (!/^\/var\/www\/korafabor\/releases\/\d{13}$/.test(current)) throw Error('Unexpected serving path');
const version = String(Date.now());
const release = website + '/releases/' + version;
const cssPath = 'assets/css/korafabor-theme.css';
await cp(current, release, { recursive: true });
await cp(stage + '/' + cssPath, release + '/' + cssPath);
await chmod(release + '/' + cssPath, 0o644);
let updatedPages = 0;
async function updatePages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) throw Error('Unexpected symlink in release');
    if (entry.isDirectory()) await updatePages(file);
    else if (entry.name.endsWith('.html') && !/^google[a-f0-9]+\.html$/.test(entry.name)) {
      const page = load(await readFile(file, 'utf8'));
      const body = page('body').html();
      page('html').addClass('korafabor-theme');
      page('link[href^="/assets/css/korafabor-theme.css"]').remove();
      page('head').append('<link rel="stylesheet" href="/' + cssPath + '?v=20261102-gold1">');
      page('meta[name="theme-color"]').attr('content', '#15191c');
      if (!page('meta[name="theme-color"]').length) page('head').append('<meta name="theme-color" content="#15191c">');
      if (page('body').html() !== body) throw Error('Content changed during theme update');
      await writeFile(file, page.html(), { mode: 0o644 });
      updatedPages++;
    }
  }
}
await updatePages(release);
const unchanged = ['sitemap.xml', 'sitemap-articles.xml', 'robots.txt', 'BingSiteAuth.xml', 'google4c7e1aa55a5300ab.html', 'assets/js/matches.js', 'assets/js/monetag-window.js', 'assets/js/app-showcase.js', 'assets/css/app-promotion.css', 'assets/css/mobile-viewport.css'];
for (const file of unchanged) {
  const digest = async root => createHash('sha256').update(await readFile(root + '/' + file)).digest('hex');
  if (await digest(current) !== await digest(release)) throw Error('Unrelated file changed: ' + file);
}
const verified = assertCompletePublication(work, release, { siteUrl: 'https://korafabor.pro' });
for (const file of [cssPath, 'scripts/migrate-korafabor.cjs']) {
  await cp(stage + '/' + file, work + '/' + file + '.theme-next');
  await chmod(work + '/' + file + '.theme-next', 0o644);
  await rename(work + '/' + file + '.theme-next', work + '/' + file);
}
const pointer = website + '/current.theme-' + process.pid;
await symlink(release, pointer);
await rename(pointer, website + '/current');
const reportFile = '/var/lib/korafabor-publish/last-publication.json';
const prior = JSON.parse(await readFile(reportFile, 'utf8'));
const report = { ...prior, ...verified, version, themeUpdatedAt: new Date().toISOString(), previousRelease: current, updatedPages };
await writeFile(reportFile, JSON.stringify(report), { mode: 0o600 });
console.log(JSON.stringify({ ...report, appOrVideoRestarted: false }));
