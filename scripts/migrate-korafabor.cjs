const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { load } = require('cheerio');
const { parse } = require('acorn');
const { validateEntry } = require('./match-archive.cjs');
const { assertCompletePublication } = require('./build-complete-site.cjs');
const OLD = 'https://koratv.click';
const SITE = 'https://korafabor.pro';
const BRAND = 'كورة فابور';
const TITLE = 'كورة فابور | kora fabor - مباريات اليوم بث مباشر';
const DESCRIPTION = 'كورة فابور korafabor.pro لمتابعة مباريات اليوم، النتائج المباشرة والإحصائيات ومواعيد اللقاءات بتوقيت المغرب، مع أخبار كرة القدم وروابط المشاهدة المتاحة.';
const MODULE_VERSION = '20261101-njalla';
function versionModuleImports(source) {
  const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const edits = [];
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const value = node.source.value;
    if (!/^(?:\.\/api\.js|\.\.\/\.\.\/shared\/(?:match-lifecycle|match-visibility)\.mjs)\?/.test(value)) continue;
    edits.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(value.split('?')[0] + '?v=' + MODULE_VERSION) });
  }
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  return source;
}
function versionFrontendModules(output) {
  for (const file of ['assets/js/api.js', 'assets/js/matches.js']) {
    const filename = path.join(output, file);
    fs.writeFileSync(filename, versionModuleImports(fs.readFileSync(filename, 'utf8')));
  }
  const filename = path.join(output, 'index.html');
  const $ = load(fs.readFileSync(filename, 'utf8'));
  for (const element of $('script[src],link[href]').toArray()) {
    const attribute = element.name === 'script' ? 'src' : 'href';
    const value = $(element).attr(attribute);
    if (/^(?:\/)?assets\/js\/(?:api|matches)\.js\?/.test(value || '')) $(element).attr(attribute, value.split('?')[0] + '?v=' + MODULE_VERSION);
  }
  fs.writeFileSync(filename, $.html());
}
const brandText = value => value.replace(/\bkoratv\.click\b/gi, 'korafabor.pro').replace(/\bkoratv\b|\bkoo?ra live\b|كورا تي في|كورة تي في|كورة لايف/gi, BRAND);
function ownedUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\/(?:www\.)?koratv\.click(?:[\/#?]|$)/i.test(value)) return value;
  const url = new URL(value);
  if (/^https?:\/\/(?:www\.)?koratv\.click$/i.test(value)) return SITE;
  return SITE + url.pathname + url.search + url.hash;
}
function structured(value, key = '') {
  if (Array.isArray(value)) return value.filter(item => key !== 'sameAs' || !['https://www.tiktok.com/@koratv.click', 'https://www.instagram.com/koratv.click'].includes(item)).map(item => structured(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, structured(item, name)]));
  if (typeof value !== 'string') return value;
  const rebased = ownedUrl(value);
  return rebased !== value ? rebased : /^(name|description|headline|alternateName|caption)$/.test(key) ? brandText(value) : value;
}
function rewriteHtml(html, route) {
  if (/^google[a-f0-9]+\.html$/.test(route)) return html;
  const $ = load(html);
  $('meta[name="ezoic-site-verification"],link[rel="dns-prefetch"][href="//quge5.com"],link[rel="dns-prefetch"][href="//nap5k.com"]').remove();
  $('link[rel="preload"][as="image"][href="/assets/images/logo-header.webp"]').remove();
  for (const element of $('[href],[src]').toArray()) {
    for (const attribute of ['href', 'src']) if ($(element).attr(attribute)) $(element).attr(attribute, ownedUrl($(element).attr(attribute)));
  }
  $('a[href="https://www.tiktok.com/@koratv.click"],a[href="https://www.instagram.com/koratv.click"]').remove();
  const adapter = $('script[src*="/assets/js/monetag-window.js"]');
  for (const script of $('script').toArray()) {
    const src = $(script).attr('src') || '';
    const code = $(script).text();
    if (src.startsWith('https://quge5.com/88/') || code.includes('https://n6wxm.com/vignette.min.js') || code.includes('https://al5sm.com/tag.min.js') || code.includes('https://nap5k.com/tag.min.js')) $(script).remove();
  }
  if (adapter.length) {
    adapter.attr('data-zones', '12170985').attr('src', '/assets/js/monetag-window.js?v=20261101-profile');
    adapter.after("<script>(function(s){s.dataset.zone='12170997',s.src='https://n6wxm.com/vignette.min.js'})([document.documentElement,document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script><script>(function(s){s.dataset.zone='12170985',s.src='https://al5sm.com/tag.min.js'})([document.documentElement,document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>");
  }
  $('title').text(brandText($('title').text()));
  for (const element of $('meta[content]').toArray()) {
    const content = $(element).attr('content');
    const value = ownedUrl(content);
    $(element).attr('content', value !== content ? value : /^https?:/.test(content) ? content : brandText(content));
  }
  $('meta[property="og:site_name"]').attr('content', BRAND);
  for (const element of $('meta[http-equiv="refresh"]').toArray()) {
    $(element).attr('content', $(element).attr('content').replace(/https?:\/\/(?:www\.)?koratv\.click(?=[\/#?]|$)/gi, SITE));
  }
  const home = route === 'index.html';
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const schema = structured(JSON.parse($(element).text()));
    for (const node of schema['@graph'] || [schema]) {
      if (['Organization', 'WebSite'].includes(node['@type']) && String(node['@id'] || '').startsWith(SITE + '/#')) {
        node.name = BRAND; node.alternateName = ['Kora Fabor', 'korafabor', 'korafabor.pro'];
      }
      if (home && node['@type'] === 'WebPage') { node.name = TITLE; node.description = DESCRIPTION; }
    }
    $(element).text(JSON.stringify(schema).replace(/</g, '\\u003c'));
  }
  $('.header-title').text(home ? TITLE : 'كورة فابور | أخبار كرة القدم والبطولات');
  if ($('.header .logo a').length) $('.header .logo a').html('<span class="korafabor-wordmark" dir="ltr"><span class="korafabor-emblem" aria-hidden="true"><b>K</b><i>F</i></span><span class="korafabor-lettering">Kora<strong>Fabor</strong><small>KORAFABOR.PRO</small></span></span>').attr('aria-label', BRAND);
  for (const element of $('.footer-logo a,.article-footer span,.article-brand').toArray()) {
    $(element).text(brandText($(element).text()));
  }
  $('.copyright p').contents().each((_, node) => { if (node.type === 'text') node.data = brandText(node.data); });
  $('.footer-logo img').attr('src', '/assets/images/korafabor-logo.svg').attr('alt', BRAND);
  $('link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]').attr('href', '/assets/images/korafabor-favicon.png?v=20261101-kf2').attr('type', 'image/png');
  if (!$('link[rel="icon"]').length) $('head').append('<link rel="icon" type="image/png" href="/assets/images/korafabor-favicon.png?v=20261101-kf2">');
  for (const element of $('img,link[rel="icon"],link[rel="shortcut icon"]').toArray()) {
    const attribute = element.name === 'img' ? 'src' : 'href';
    const value = $(element).attr(attribute) || '';
    if (/^(?:https:\/\/korafabor\.pro)?\/assets\/images\/(?:logo(?:-header)?\.(?:png|webp)|favicon\.ico)$/.test(value))
      $(element).attr(attribute, element.name === 'img' ? '/assets/images/korafabor-logo.svg' : '/assets/images/korafabor-favicon.png');
    if (element.name === 'link' && $(element).attr('href') === '/assets/images/korafabor-favicon.png') $(element).attr('type', 'image/png');
    if ($(element).attr('alt')) $(element).attr('alt', brandText($(element).attr('alt')));
  }
  for (const element of $('meta[property="og:image"],meta[name="twitter:image"]').toArray()) {
    if (/\/assets\/images\/logo(?:-header)?\.(?:png|webp)$/.test($(element).attr('content') || '')) $(element).attr('content', SITE + '/assets/images/korafabor-social.png');
  }
  if ($('meta[property="og:image"]').attr('content') === SITE + '/assets/images/korafabor-social.png') {
    $('meta[property="og:image:width"],meta[property="og:image:height"]').remove();
    $('head').append('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
  }
  $('link[href^="/assets/css/korafabor-brand.css"]').remove();
  if ($('body .header,.article-header').length) $('head').append('<link rel="stylesheet" href="/assets/css/korafabor-brand.css?v=20261101-logo3">');
  $('link[href^="/assets/css/mobile-viewport.css"]').remove();
  const matchViewport = $('.matches-main,.match-detail,link[href*="/assets/css/matches.css"],style[data-source="/assets/css/matches.css"]').length > 0;
  $('html').toggleClass('match-viewport', matchViewport);
  if (matchViewport) $('head').append('<link rel="stylesheet" href="/assets/css/mobile-viewport.css?v=20261101-scroll1">');
  $('html').addClass('korafabor-theme');
  $('link[href^="/assets/css/korafabor-theme.css"]').remove();
  $('head').append('<link rel="stylesheet" href="/assets/css/korafabor-theme.css?v=20261102-gold2">');
  $('meta[name="theme-color"]').attr('content', '#15191c');
  if (!$('meta[name="theme-color"]').length) $('head').append('<meta name="theme-color" content="#15191c">');
  if (home) {
    $('title').text(TITLE);
    for (const [attribute, name] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) {
      $(`meta[${attribute}="${name}"]`).attr('content', DESCRIPTION);
    }
    for (const [attribute, name] of [['property', 'og:title'], ['name', 'twitter:title']]) $(`meta[${attribute}="${name}"]`).attr('content', TITLE);
    $('head').append('<script data-korafabor-api>window.__MATCHES_API_ORIGIN__=location.origin;</script>');
  }
  for (const image of $('.scoreline img').toArray()) {
    if (!$(image).attr('width')) $(image).attr('width', '48');
    if (!$(image).attr('height')) $(image).attr('height', '48');
  }
  const meta = (attribute, key, value) => {
    if (!value || $(`meta[${attribute}="${key}"]`).length) return;
    $('head').append($('<meta>').attr({ [attribute]: key, content: value }));
  };
  const description = $('meta[name="description"]').attr('content') || '';
  const image = $('meta[property="og:image"]').attr('content')
    || $('.scoreline img').first().attr('src') || SITE + '/assets/images/logo-header.webp';
  meta('property', 'og:title', $('title').text());
  meta('property', 'og:description', description);
  meta('property', 'og:type', 'website');
  meta('property', 'og:image', image);
  meta('name', 'twitter:card', 'summary');
  meta('name', 'twitter:title', $('title').text());
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', image);
  const promotion = $('.app-promotion-link');
  if (promotion.length) {
    const destination = new URL(promotion.attr('href'));
    if (destination.origin === 'https://play.google.com' && destination.searchParams.get('id') === 'com.korascoreai.app') {
      const attribution = new URLSearchParams(destination.searchParams.get('referrer'));
      attribution.set('utm_source', 'korafabor');
      destination.searchParams.set('referrer', attribution.toString());
      promotion.attr('href', destination.href);
    }
  }
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical && new URL(canonical, SITE).origin !== SITE) throw Error('Wrong migrated canonical');
  return $.html();
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Symlink in public artifact');
    return entry.isDirectory() ? files(filename) : [filename];
  });
}
function migrate(output, root = path.resolve(__dirname, '..')) {
  versionFrontendModules(output);
  for (const file of fs.readdirSync(output).filter(file => /^pinterest-[a-f0-9]+\.html$/i.test(file))) fs.unlinkSync(path.join(output, file));
  const before = files(output);
  const sourceCount = before.filter(file => file.endsWith('.html')).length;
  for (const filename of before.filter(file => file.endsWith('.html'))) {
    if (/^google[a-f0-9]+\.html$/.test(path.basename(filename))) continue;
    fs.writeFileSync(filename, rewriteHtml(fs.readFileSync(filename, 'utf8'), path.relative(output, filename).split(path.sep).join('/')));
  }
  for (const name of ['sitemap.xml', 'sitemap-articles.xml']) {
    const filename = path.join(output, name);
    const $ = load(fs.readFileSync(filename, 'utf8'), { xmlMode: true });
    $('loc').each((_, element) => $(element).text(ownedUrl($(element).text())));
    fs.writeFileSync(filename, $.xml());
  }
  for (const name of ['news/catalog.json', 'news/feed.json']) {
    const filename = path.join(output, name);
    fs.writeFileSync(filename, JSON.stringify(structured(JSON.parse(fs.readFileSync(filename, 'utf8')))));
  }
  const catalogFile = path.join(output, 'archive/catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  if (catalog.version !== 2 || !Array.isArray(catalog.shards)) throw Error('Expected complete sharded match archive');
  for (const shard of catalog.shards) {
    if (!/^(?:\d{4}-\d{2}|undated)-[a-f0-9]{16}\.json$/.test(shard.file)) throw Error('Unsafe archive shard');
    const original = path.join(output, 'archive/data', shard.file);
    const body = fs.readFileSync(original, 'utf8');
    if (createHash('sha256').update(body).digest('hex') !== shard.hash) throw Error('Source archive checksum mismatch');
    const entries = JSON.parse(body);
    for (const entry of entries) {
      validateEntry(entry, { siteUrl: OLD });
      entry.html = rewriteHtml(entry.html, 'archive-entry');
      validateEntry(entry, { siteUrl: SITE });
    }
    const serialized = JSON.stringify(entries);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const name = shard.file.replace(/[a-f0-9]{16}\.json$/, hash.slice(0, 16) + '.json');
    fs.writeFileSync(path.join(output, 'archive/data', name), serialized);
    if (name !== shard.file) fs.unlinkSync(original);
    Object.assign(shard, { file: name, hash });
  }
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  const robots = fs.readFileSync(path.join(output, 'robots.txt'), 'utf8').split(/\r?\n/)
    .map(line => line.startsWith('Sitemap: ') ? 'Sitemap: ' + ownedUrl(line.slice(9)) : line).join('\n');
  fs.writeFileSync(path.join(output, 'robots.txt'), robots);
  fs.writeFileSync(path.join(output, 'CNAME'), 'korafabor.pro\n');
  fs.copyFileSync(path.join(root, 'assets/css/korafabor-brand.css'), path.join(output, 'assets/css/korafabor-brand.css'));
  fs.copyFileSync(path.join(root, 'assets/css/mobile-viewport.css'), path.join(output, 'assets/css/mobile-viewport.css'));
  fs.copyFileSync(path.join(root, 'assets/css/korafabor-theme.css'), path.join(output, 'assets/css/korafabor-theme.css'));
  const publication = assertCompletePublication(root, output, { siteUrl: SITE });
  const $ = load(fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8'), { xmlMode: true });
  $('loc').each((_, element) => {
    const url = new URL($(element).text());
    if (url.origin !== SITE) throw Error('Offsite sitemap target');
    const route = decodeURIComponent(url.pathname);
    const filename = path.join(output, route.endsWith('/') ? route + 'index.html' : route);
    if (!fs.existsSync(filename)) throw Error('Missing migrated sitemap target: ' + route);
  });
  return { ...publication, htmlPages: sourceCount, siteUrl: SITE };
}
module.exports = { migrate, rewriteHtml, structured, ownedUrl, versionFrontendModules, versionModuleImports, SITE, TITLE };
if (require.main === module) console.log(JSON.stringify(migrate(path.resolve(process.argv[2] || '_site'))));
