const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { rewriteHtml, ownedUrl, TITLE, versionModuleImports } = require('./migrate-korafabor.cjs');
const { HOME_TITLE, HOME_HEADING, HOME_DESCRIPTION } = require('./korafabor-seo.cjs');
const { matchPage, matchSlug } = require('./generate-match-pages.cjs');
const { publicMatchId } = require('../shared/public-match-id.mjs');

test('KoraFabor home specializes in live matches with consistent search and share metadata', () => {
  const source = '<head><title>koratv</title><meta name="keywords" content="old"><link rel="canonical" href="https://koratv.click/"><script type="application/ld+json">{"@graph":[{"@type":"WebPage","name":"old"},{"@type":"WebSite","name":"koratv"}]}</script></head><header class="header"><h1 class="header-title">old</h1><nav class="nav"><a href="/">old</a></nav></header><section class="featured-section"><h2 class="section-title"><i class="fas fa-tv"></i>old</h2></section>';
  const first = rewriteHtml(source, 'index.html');
  const $ = load(rewriteHtml(first, 'index.html'));
  assert.equal($('title').text(), HOME_TITLE);
  assert.equal($('h1').text(), HOME_HEADING);
  assert.equal($('.section-title').text().trim(), 'مباريات اليوم بث مباشر');
  assert.equal($('.section-title i').length, 1);
  assert.equal($('.nav a').text(), 'مباريات اليوم بث مباشر');
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    assert.equal($(selector).length, 1);
    assert.equal($(selector).attr('content'), HOME_DESCRIPTION);
  }
  assert.equal($('meta[property="og:title"]').attr('content'), HOME_TITLE);
  assert.equal($('meta[name="twitter:title"]').attr('content'), HOME_TITLE);
  assert.equal($('meta[name="keywords"]').length, 0);
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://korafabor.pro/');
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  assert.equal(graph[0].name, HOME_TITLE);
  assert.equal(graph[0].description, HOME_DESCRIPTION);
  assert.equal(graph[1].description, HOME_DESCRIPTION);
  assert.doesNotMatch(HOME_TITLE + HOME_DESCRIPTION, /يلا شوت|كورة لايف|بدون تقطيع|4K|مجانا/);
});

const selectedFixture = {
  match_id: 'kooora_2026-11-27_بريست_vs_باريس', home_team: 'بريست', away_team: 'باريس',
  league: 'الدوري الفرنسي', kickoff_time: '2026-11-27T19:45:00Z',
  payload: { status: '1H', score: '0 - 0' }
};
const seoNow = new Date('2026-11-27T20:00:00Z');
const fixtureRoute = row => `match/${matchSlug(row)}/index.html`;
const fixtureHtml = row => matchPage(row, { siteUrl: 'https://koratv.click', brand: 'koratv' }).html;

test('selected live match has accurate live intent and the existing public player URL only', () => {
  const first = rewriteHtml(fixtureHtml(selectedFixture), fixtureRoute(selectedFixture), { now: seoNow });
  const $ = load(rewriteHtml(first, fixtureRoute(selectedFixture), { now: seoNow }));
  assert.equal($('title').text(), 'بث مباشر مباراة بريست ضد باريس | كورة فابور');
  assert.equal($('h1').text(), 'بث مباشر مباراة بريست ضد باريس');
  assert.equal($('.korafabor-watch-link').length, 1);
  assert.equal($('.korafabor-watch-link').attr('href'), `https://fabor.sbs/739184.html?match=${publicMatchId(selectedFixture.match_id)}`);
  assert.match($('.scoreline').text(), /0 - 0/);
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  assert.equal(graph[0].name, $('title').text());
  assert.equal(graph[0].description, $('meta[name="description"]').attr('content'));
  assert.ok(!graph.some(node => ['VideoObject', 'BroadcastEvent'].includes(node['@type'])));
});

test('selected upcoming match describes its broadcast schedule without claiming to be live', () => {
  const row = { ...selectedFixture, payload: { status: 'NS' } };
  const $ = load(rewriteHtml(fixtureHtml(row), fixtureRoute(row), { now: seoNow }));
  assert.equal($('title').text(), 'موعد بث مباراة بريست ضد باريس والقنوات الناقلة | كورة فابور');
  assert.equal($('h1').text(), 'بريست ضد باريس');
  assert.equal($('.korafabor-watch-link').length, 0);
});

test('ended, unselected, stale-day and archived fixtures keep their original result intent', () => {
  for (const [row, route, now] of [
    [{ ...selectedFixture, payload: { status: 'FT', score: '2 - 1' } }, fixtureRoute(selectedFixture), seoNow],
    [{ ...selectedFixture, match_id: 'other-live-fixture' }, null, seoNow],
    [selectedFixture, fixtureRoute(selectedFixture), new Date('2026-11-28T01:00:00Z')],
    [selectedFixture, 'archive-entry', seoNow]
  ]) {
    const $ = load(rewriteHtml(fixtureHtml(row), route || fixtureRoute(row), { now }));
    assert.equal($('title').text(), 'بريست ضد باريس: الموعد والنتيجة والإحصاءات | كورة فابور');
    assert.equal($('h1').text(), 'بريست ضد باريس');
    assert.equal($('.korafabor-watch-link').length, 0);
  }
});

test('live SEO changes do not rewrite news titles or article schema', () => {
  const source = '<head><title>خبر رياضي | koratv</title><meta name="description" content="تفاصيل الخبر"><script type="application/ld+json">{"@type":"NewsArticle","headline":"خبر رياضي","description":"تفاصيل الخبر"}</script></head><main><h1>خبر رياضي</h1></main>';
  const $ = load(rewriteHtml(source, 'news/example/index.html'));
  assert.equal($('title').text(), 'خبر رياضي | كورة فابور');
  assert.equal($('meta[name="description"]').attr('content'), 'تفاصيل الخبر');
  assert.equal(JSON.parse($('script[type="application/ld+json"]').text()).headline, 'خبر رياضي');
});

test('KoraFabor yellow identity cannot inherit the KoraTV green override', () => {
  const $ = load(rewriteHtml('<head><link rel="stylesheet" href="/assets/css/koratv-green-pages.css?v=old"><style data-source="/assets/css/koratv-green-pages.css">body{background:green!important}</style></head><body><header class="header"></header></body>', 'index.html'));
  assert.equal($('[href*="koratv-green-pages.css"],style[data-source*="koratv-green-pages.css"]').length, 0);
  assert.match($('link[href*="korafabor-theme.css"]').attr('href'), /20261117-glass1/);
  assert.equal($('meta[name="theme-color"]').attr('content'), '#f9d447');
});

test('mobile viewport fix is scoped, repeatable and does not alter match data or advertising', () => {
  const source = '<head><link rel="stylesheet" href="/assets/css/matches.css"></head><main class="matches-main"><p>Home 2 - 1 Away</p></main>';
  const first = rewriteHtml(source, 'index.html');
  const $ = load(rewriteHtml(first, 'index.html'));
  assert.ok($('html').hasClass('match-viewport'));
  assert.equal($('link[href*="mobile-viewport.css"]').length, 1);
  assert.equal($('main p').text(), 'Home 2 - 1 Away');
  assert.equal($('script[src*="mobile-viewport"]').length, 0);
  const news = load(rewriteHtml('<head><link rel="stylesheet" href="/assets/css/news.css"></head><main class="news-main"></main>', 'news.html'));
  assert.equal(news('html').hasClass('match-viewport'), false);
  assert.equal(news('link[href*="mobile-viewport.css"]').length, 0);
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../assets/css/mobile-viewport.css'), 'utf8');
  assert.match(css, /background-color: #151c2b/);
  assert.match(css, /height: 100lvh/);
  assert.match(css, /background-attachment: scroll/);
  assert.match(css, /pointer-events: none/);
  assert.doesNotMatch(css, /overflow(?:-y)?:\s*(?:hidden|clip)|touch-action:\s*none|overscroll-behavior:\s*none/);
});

test('all public page types use the new cache-versioned Kora Fabor favicon', () => {
  for (const route of ['index.html', 'news.html', 'news/example/index.html', 'archive-entry']) {
    const $ = load(rewriteHtml('<head><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/old.png"></head>', route));
    assert.equal($('link[rel="icon"]').attr('href'), '/assets/images/korafabor-favicon.png?v=20261101-kf2');
    assert.equal($('link[rel="icon"]').attr('type'), 'image/png');
    assert.equal($('link[rel="apple-touch-icon"]').attr('href'), $('link[rel="icon"]').attr('href'));
  }
  assert.equal(load(rewriteHtml('<head><title>News</title></head>', 'news.html'))('link[rel="icon"]').length, 1);
});
test('domain migration changes owned URLs and truthful brand without changing providers or external sources', () => {
  assert.equal(ownedUrl('https://koratv.click/news/a/?x=1#two'), 'https://korafabor.pro/news/a/?x=1#two');
  assert.equal(ownedUrl('https://koratv.click'), 'https://korafabor.pro');
  assert.equal(ownedUrl('https://stream-api.koratv.click/api/matches'), 'https://stream-api.koratv.click/api/matches');
  assert.equal(ownedUrl('https://koratv.click.evil.test/'), 'https://koratv.click.evil.test/');
  const html = '<html><head><title>koratv | stats</title><meta name="description" content="stats"><link rel="canonical" href="https://koratv.click/"><script type="application/ld+json">{"@graph":[{"@type":"WebSite","@id":"https://koratv.click/#website","name":"koratv"},{"@type":"WebPage","name":"old"}]}</script></head><body><header class="header"><div class="logo"><a href="/"><img></a></div><h1 class="header-title">koratv</h1></header><a href="https://fabor.sbs/739184.html?match=123">Watch</a><a href="https://source.test/original">Source</a><aside data-nosnippet>KoraScoreAi</aside></body></html>';
  const $ = load(rewriteHtml(html, 'index.html'));
  assert.equal($('title').text(), TITLE);
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://korafabor.pro/');
  assert.match($('script[data-korafabor-api]').text(), /location.origin/);
  assert.equal($('a[href*="fabor.sbs"]').attr('href'), 'https://fabor.sbs/739184.html?match=123');
  assert.equal($('a[href*="source.test"]').attr('href'), 'https://source.test/original');
  assert.equal($('aside[data-nosnippet]').text(), 'KoraScoreAi');
  assert.equal(JSON.parse($('script[type="application/ld+json"]').text())['@graph'][0].name, 'كورة فابور');
});
test('archived result migration never adds executable scripts or changes team headings', () => {
  const $ = load(rewriteHtml('<head><title>Home vs Away | koratv</title><link rel="canonical" href="https://koratv.click/match/test/"></head><main class="match-detail"><h1>Home ضد Away</h1><p>2 - 1</p></main>', 'archive-entry'));
  assert.equal($('h1').text(), 'Home ضد Away');
  assert.equal($('main p').text(), '2 - 1');
  assert.equal($('script').length, 0);
});
test('rebranding preserves the live footer year hook and supplies share metadata', () => {
  const $ = load(rewriteHtml('<head><title>koratv</title><meta name="description" content="Scores"></head><footer class="copyright"><p>Copyright <span id="current-year"></span> koratv</p></footer><main><div class="scoreline"><img src="https://images.test/team.png" alt="Team"></div></main>', 'news.html'));
  assert.equal($('#current-year').length, 1);
  assert.equal($('.scoreline img').attr('width'), '48');
  assert.equal($('meta[name="twitter:image"]').attr('content'), 'https://images.test/team.png');
});
test('module cache versions change only parsed local imports, never ad URLs or unrelated strings', () => {
  const result = versionModuleImports("import { x } from '../../shared/match-lifecycle.mjs?v=old'; const ad='https://advertiser.test/tag.js?v=old';");
  assert.match(result, /match-lifecycle\.mjs\?v=20261128-broadcasts/);
  assert.match(result, /https:\/\/advertiser\.test\/tag\.js\?v=old/);
});

test('Google verification stays byte-identical and legacy public branding and ad zones are retired', () => {
  const proof = 'google-site-verification: google4c7e1aa55a5300ab.html\r\n';
  assert.equal(rewriteHtml(proof, 'google4c7e1aa55a5300ab.html'), proof);
  const $ = load(rewriteHtml('<head><title>كورة لايف</title><link rel="canonical" href="https://koratv.click/news.html"><script src="/assets/js/monetag-window.js" data-zones="11820367" data-mobile-swap="off" data-components="news"></script><script src="https://quge5.com/88/tag.min.js" data-zone="281844"></script><script>(function(s){s.dataset.zone="11820368",s.src="https://n6wxm.com/vignette.min.js"})(document.createElement("script"))</script></head><footer class="copyright"><p>Copyright <span id="current-year"></span> Koratv.Click</p></footer>', 'news.html'));
  assert.equal($('script[src*="monetag-window"]').attr('data-zones'), '12170985');
  assert.doesNotMatch($.html(), /1182036[78]|281844|quge5\.com|كورة لايف|Koratv\.Click/);
  assert.match($('.copyright').text(), /korafabor\.pro/);
  assert.equal($('#current-year').length, 1);
});

test('legacy error and duplicate pages without a window adapter cannot retain old ads', () => {
  const html = '<head><title>كورة لايف</title><script src="https://quge5.com/88/tag.min.js" data-zone="260051"></script><script>(function(s){s.dataset.zone="11638896",s.src="https://al5sm.com/tag.min.js"})(document.createElement("script"))</script><script>(function(s){s.dataset.zone="11639220",s.src="https://nap5k.com/tag.min.js"})(document.createElement("script"))</script></head><body><header class="header"><div class="logo"><a href="/"></a></div></header></body>';
  const first = rewriteHtml(html, '404.html');
  const second = rewriteHtml(first, '404.html');
  assert.doesNotMatch(second, /11638896|11639220|quge5|nap5k|al5sm/);
  assert.equal(load(second)('link[href*="korafabor-brand.css"]').length, 1);
});
