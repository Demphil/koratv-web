const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.local/korafabor-source');
if (fs.readFileSync(path.join(root, '_site/CNAME'), 'utf8').trim() !== 'koratv.click') {
  throw Error('Build the original source profile before staging; migrated output is not an archive seed.');
}
if (fs.existsSync(stage)) {
  if (fs.realpathSync(stage) !== stage) throw Error('Unexpected staging path');
  fs.rmSync(stage, { recursive: true, force: true });
}
fs.mkdirSync(stage, { recursive: true });
const copy = name => {
  fs.mkdirSync(path.dirname(path.join(stage, name)), { recursive: true });
  fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
};
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html') || /^[a-f0-9]{32}\.txt$/.test(name))) copy(file);
for (const directory of ['assets', 'abroad', 'at-work', 'low-internet', 'smart-tv', 'content']) copy(directory);
for (const file of ['CNAME', 'robots.txt', 'sitemap.xml', 'sw.js']) if (fs.existsSync(path.join(root, file))) copy(file);
for (const file of ['build-public-site.cjs', 'build-complete-site.cjs', 'generate-match-pages.cjs',
  'news-pages.cjs', 'match-archive.cjs', 'prerender-match-list.cjs', 'public-analytics.cjs',
  'migrate-korafabor.cjs', 'build-state.cjs']) copy('scripts/' + file);
for (const file of ['match-broadcasts.mjs', 'match-lifecycle.mjs', 'match-visibility.mjs', 'league-whitelist.mjs',
  'site-build-feed.mjs', 'provider-channel-match.mjs', 'channel-name-match.mjs']) copy('shared/' + file);
for (const file of ['korafabor-publish.mjs', 'static-package.json', 'kora-static-publish.service',
  'kora-static-publish.timer', 'kora-static-publish.slice', 'korafabor-site.conf', 'install-korafabor-site.mjs',
  'activate-korafabor.mjs']) copy('site-data/' + file);
const seed = path.join(stage, 'seed');
fs.mkdirSync(path.join(seed, 'news'), { recursive: true });
fs.cpSync(path.join(root, '_site/archive'), path.join(seed, 'archive'), { recursive: true });
fs.copyFileSync(path.join(root, '_site/news/catalog.json'), path.join(seed, 'news/catalog.json'));
execFileSync('tar', ['-czf', path.join(root, '.local/korafabor-source.tgz'), '-C', stage, '.']);
console.log('Scoped source and current public archive seed staged. No backend environments or database exports included.');
