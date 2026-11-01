import { readFile, writeFile, cp, rename, symlink, readdir, realpath, chmod, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
const work = '/var/lib/korafabor-publish/work';
const website = '/var/www/korafabor';
const state = '/var/lib/korafabor-publish';
const stage = process.argv[2];
if (process.getuid() === 0 || process.cwd() !== work || !/^\/opt\/korafabor-promotion-\d{8}$/.test(stage || ''))
  throw Error('Use the isolated publisher user and a scoped promotion stage under the publication lock');
const require = createRequire(work + '/scripts/migrate-korafabor.cjs');
const { load } = require('cheerio');
const { assertCompletePublication } = require(work + '/scripts/build-complete-site.cjs');
const current = await realpath(website + '/current');
if (!new RegExp('^' + website + '/releases/\\d{13}$').test(current)) throw Error('Unexpected serving path');
const $ = load(await readFile(current + '/index.html', 'utf8'));
const source = load(await readFile(stage + '/index.html', 'utf8'));
const ad = source('aside.app-promotion');
if (ad.length !== 1 || ad.find('a').length !== 1 || ad.find('.app-promotion-display').length !== 1)
  throw Error('Unexpected promotion markup');
const destination = new URL(ad.find('a').attr('href'));
if (destination.origin !== 'https://play.google.com' || destination.searchParams.get('id') !== 'com.korascoreai.app')
  throw Error('Unexpected store destination');
const referrer = new URLSearchParams(destination.searchParams.get('referrer'));
referrer.set('utm_source', 'korafabor');
destination.searchParams.set('referrer', referrer.toString());
ad.find('a').attr('href', destination.href);
const outsideAd = html => {
  const document = load(html);
  document('aside.app-promotion,link[href*="/assets/css/app-promotion.css"],script[src*="/assets/js/app-showcase.js"],link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]').remove();
  return document.html();
};
const before = outsideAd($.html());
$('aside.app-promotion').replaceWith(ad.toString());
$('link[href*="/assets/css/app-promotion.css"]').attr('href', '/assets/css/app-promotion.css?v=20261101-reference4');
$('script[src*="/assets/js/app-showcase.js"]').attr('src', '/assets/js/app-showcase.js?v=20261101-reference4');
if (outsideAd($.html()) !== before) throw Error('Unrelated homepage content changed');
const assets = ['assets/css/app-promotion.css', 'assets/js/app-showcase.js', 'assets/images/google-play-badge.png', 'assets/images/korascoreai-forecast-engine.webp', 'assets/images/korafabor-favicon.png', 'assets/images/favicon.ico', 'favicon.ico'];
const version = String(Date.now());
const release = website + '/releases/' + version;
await cp(current, release, { recursive: true });
for (const file of assets) { await cp(stage + '/' + file, release + '/' + file); await chmod(release + '/' + file, 0o644); }
await writeFile(release + '/index.html', $.html(), { mode: 0o644 });
async function updateIcons(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) throw Error('Unexpected symlink in release');
    if (entry.isDirectory()) await updateIcons(file);
    else if (entry.name.endsWith('.html') && !/^google[a-f0-9]+\.html$/.test(entry.name)) {
      const page = load(await readFile(file, 'utf8'));
      page('link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]').attr('href', '/assets/images/korafabor-favicon.png?v=20261101-kf2').attr('type', 'image/png');
      if (!page('link[rel="icon"]').length) page('head').append('<link rel="icon" type="image/png" href="/assets/images/korafabor-favicon.png?v=20261101-kf2">');
      await writeFile(file, page.html(), { mode: 0o644 });
    }
  }
}
await updateIcons(release);
const verified = assertCompletePublication(work, release, { siteUrl: 'https://korafabor.pro' });
// Keep the next scheduled build on the same promotion without changing the source domain profile.
for (const file of ['index.html', 'scripts/migrate-korafabor.cjs', 'scripts/build-public-site.cjs', 'scripts/build-public-brand.cjs', ...assets]) {
  await cp(stage + '/' + file, work + '/' + file + '.promotion-next');
  await chmod(work + '/' + file + '.promotion-next', 0o644);
  await rename(work + '/' + file + '.promotion-next', work + '/' + file);
}
const pointer = website + '/current.promotion-' + process.pid;
await symlink(release, pointer);
await rename(pointer, website + '/current');
const prior = JSON.parse(await readFile(state + '/last-publication.json', 'utf8'));
const report = { ...prior, ...verified, version, promotionUpdatedAt: new Date().toISOString(), previousRelease: current };
await writeFile(state + '/last-publication.json', JSON.stringify(report), { mode: 0o600 });
const versions = (await readdir(website + '/releases')).filter(name => /^\d{13}$/.test(name)).sort().reverse();
for (const old of versions.slice(3)) {
  const target = website + '/releases/' + old;
  if (await realpath(target) !== target) throw Error('Unsafe cleanup target');
  await rm(target, { recursive: true });
}
console.log(JSON.stringify({ ...report, appOrVideoRestarted: false }));
