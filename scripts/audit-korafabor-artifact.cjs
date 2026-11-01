const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const directory = fs.realpathSync(process.argv[2] || '_site');
const origin = 'https://korafabor.pro';
const errors = [], warnings = [];
let htmlPages = 0, indexablePages = 0;
const walk = base => fs.readdirSync(base, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(base, entry.name);
  if (entry.isSymbolicLink()) throw Error('Unexpected artifact symlink');
  return entry.isDirectory() ? walk(file) : [file];
});
for (const file of walk(directory)) {
  if (!/\.(?:html|js|json|xml|txt)$/.test(file)) continue;
  const relative = path.relative(directory, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');
  if (/11638896|11639220|1182036[78]|quge5\.com\/88|https:\/\/nap5k\.com\/tag|korascoreai-analyst-preview\.webp/.test(source)) errors.push(relative + ': retired advertisement or rejected preview');
  if (!file.endsWith('.html') || /^google[a-f0-9]+\.html$/.test(path.basename(file))) continue;
  htmlPages++;
  const $ = load(source);
  if (/noindex/i.test($('meta[name="robots"]').attr('content') || '') || $('meta[http-equiv="refresh"]').length) continue;
  indexablePages++;
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical || new URL(canonical, origin).origin !== origin) errors.push(relative + ': wrong canonical');
  for (const el of $('[href],[src]').toArray()) {
    for (const attr of ['href', 'src']) {
      const value = $(el).attr(attr);
      if (!value || !/^https?:\/\//.test(value)) continue;
      if (/^(?:www\.)?koratv\.click$/.test(new URL(value).hostname)) errors.push(relative + ': old public origin');
    }
  }
  if (/koratv|كورة تي في|كورا تي في|كورة لايف|kora live/i.test($('title').text() + ' ' + $('.header-title,.footer-logo,.copyright').text()))
    errors.push(relative + ': old visible publisher identity');
}
for (const name of ['sitemap.xml', 'sitemap-articles.xml']) {
  const $ = load(fs.readFileSync(path.join(directory, name), 'utf8'), { xmlMode: true });
  const urls = $('loc').map((_, element) => $(element).text()).get();
  if (!urls.length || urls.some(url => new URL(url).origin !== origin)) errors.push(name + ': invalid sitemap origin');
}
const robots = fs.readFileSync(path.join(directory, 'robots.txt'), 'utf8');
for (const name of ['sitemap.xml', 'sitemap-articles.xml']) if (!robots.includes(origin + '/' + name)) errors.push('robots.txt: missing ' + name);
const proof = fs.readFileSync(path.join(directory, 'google4c7e1aa55a5300ab.html'), 'utf8').trim();
if (proof !== 'google-site-verification: google4c7e1aa55a5300ab.html') errors.push('Google verification content changed');
if (!fs.readFileSync(path.join(directory, 'BingSiteAuth.xml'), 'utf8').includes('E7422F1BC31FC54953113B2DDC58DCA7')) errors.push('Bing verification missing');
if (fs.existsSync(path.join(directory, 'assets/images/korascoreai-analyst-preview.webp'))) errors.push('Rejected preview still published');
console.log(JSON.stringify({ htmlPages, indexablePages, errors, warnings, sourceProfileOriginExcluded: true }));
if (errors.length) process.exitCode = 1;
