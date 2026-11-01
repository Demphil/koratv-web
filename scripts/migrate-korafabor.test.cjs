const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { rewriteHtml, ownedUrl, TITLE, versionModuleImports } = require('./migrate-korafabor.cjs');
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
  assert.match(result, /match-lifecycle\.mjs\?v=20261101-njalla/);
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
