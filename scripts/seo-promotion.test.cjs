const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const root = path.resolve(__dirname, '..');

test('homepage has one consistent brand graph, useful title and no competitor identities', () => {
  const $ = load(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.equal($('h1').length, 1);
  assert.match($('title').text(), /^koratv \| كورة تي في - نتائج مباريات اليوم وإحصائياتها$/);
  assert.match($('meta[name="description"]').attr('content'), /الأحداث الحية/);
  assert.match($('meta[name="robots"]').attr('content'), /max-snippet:-1/);
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://koratv.click/');
  assert.equal($('script[type="application/ld+json"]').length, 1);
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  for (const type of ['WebSite', 'Organization']) {
    const nodes = graph.filter(node => node['@type'] === type);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'koratv');
    assert.ok(nodes[0].alternateName.includes('كورة تي في'));
  }
  assert.doesNotMatch(JSON.stringify(graph), /koraylive|sirtv|4K UHD|foundingDate/);
});

test('app placement is a disclosed external promotion, not the publisher identity or a fake endorsement', () => {
  const $ = load(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const ad = $('aside.app-promotion');
  assert.equal(ad.length, 1);
  assert.ok(ad.is('[data-nosnippet][data-no-popunder]'));
  assert.equal(ad.find('.app-promotion-label').text(), 'إعلان');
  const link = ad.find('a');
  const target = new URL(link.attr('href'));
  assert.equal(target.origin, 'https://play.google.com');
  assert.equal(target.searchParams.get('id'), 'com.korascoreai.app');
  assert.equal(new URLSearchParams(target.searchParams.get('referrer')).get('utm_source'), 'koratv');
  assert.equal(link.attr('target'), '_blank');
  for (const value of ['sponsored', 'noopener', 'noreferrer']) assert.ok(link.attr('rel').split(/\s+/).includes(value));
  assert.ok(link.is('[data-no-popunder]'));
  assert.doesNotMatch(ad.text(), /تطبيقنا|بدون إعلانات|لا يُحجب|99%|Google Ads|إعلان ممول/);
  assert.equal(ad.find('img').attr('width'), '76');
  assert.equal(ad.find('img').attr('height'), '76');
  assert.ok(fs.statSync(path.join(root, ad.find('img').attr('src'))).size < 30000);
  assert.ok($('main').children().first().is('aside.app-promotion'));
});

test('SEO maintenance does not downgrade asset versions or overwrite ad and playback text', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/apply-seo.js'), 'utf8');
  assert.doesNotMatch(source, /matches\\\.js\\\?v=|matches\\\.css\\\?v=/);
  assert.doesNotMatch(source, /html\.replace\(\/مباريات اليوم بث مباشر/);
});

test('app display uses its own emerald and coral identity, real preview and official store badge', () => {
  const $ = load(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const ad = $('.app-promotion');
  assert.equal(ad.find('.app-promotion-name').text(), 'KoraScoreAi');
  assert.equal(ad.find('.app-promotion-name span').length, 3);
  assert.equal(ad.find('.app-promotion-stage img').attr('src'), '/assets/images/korascoreai-analyst-preview.webp');
  assert.equal(ad.find('.app-promotion-link img').attr('src'), '/assets/images/google-play-badge.png');
  assert.equal(ad.find('.app-promotion-reel span').length, 3);
  const css = fs.readFileSync(path.join(root, 'assets/css/app-promotion.css'), 'utf8');
  assert.match(css, /#23be89/);
  assert.match(css, /#e94968/);
  assert.doesNotMatch(css, /#d9b86c/i);
  assert.match(css, /rotateY/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width: 700px/);
  for (const file of ['korascoreai-analyst-preview.webp', 'google-play-badge.png'])
    assert.ok(fs.statSync(path.join(root, 'assets/images', file)).size < 100000);
});
