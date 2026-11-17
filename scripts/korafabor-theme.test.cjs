const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { rewriteHtml } = require('./migrate-korafabor.cjs');
const css = fs.readFileSync(path.join(__dirname, '../assets/css/korafabor-theme.css'), 'utf8');

test('yellow glass theme is idempotent across public page types and keeps mobile repair before theme', () => {
  for (const route of ['index.html', 'news.html', 'news/example/index.html', 'archive-entry']) {
    const first = rewriteHtml('<head><meta name="theme-color" content="#1d3557"></head><main class="match-detail"><h1>Home 2 - 1 Away</h1></main>', route);
    const $ = load(rewriteHtml(first, route));
    assert.ok($('html').hasClass('korafabor-theme'));
    assert.equal($('link[href*="korafabor-theme.css"]').length, 1);
    assert.equal($('link[rel="stylesheet"]').last().attr('href'), '/assets/css/korafabor-theme.css?v=20261117-glass1');
    assert.equal($('meta[name="theme-color"]').attr('content'), '#f9d447');
    assert.equal($('main h1').text(), 'Home 2 - 1 Away');
  }
  const proof = 'google-site-verification: google4c7e1aa55a5300ab.html\r\n';
  assert.equal(rewriteHtml(proof, 'google4c7e1aa55a5300ab.html'), proof);
  assert.equal(load(rewriteHtml('<head><title>Article</title></head>', 'news/example/index.html'))('meta[name="theme-color"]').attr('content'), '#f9d447');
});

test('site theme leaves app identity, team assets, status badges and streaming behavior alone', () => {
  assert.doesNotMatch(css, /\.app-promotion|\.showcase|\.card-dot|\.live-badge|\.team\s+img|\/api\/|url\(/);
  assert.match(css, /--kf-gold: #f9d447/);
  assert.match(css, /--kf-white: #f5f7f4/);
  assert.match(css, /--match-viewport-background: var\(--kf-backdrop\)/);
  assert.match(css, /#featured-matches\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /#featured-matches\s*\{[^}]*auto-fill/);
  assert.match(css, /background-attachment: scroll/);
  assert.doesNotMatch(css, /overflow(?:-y)?:\s*(?:hidden|clip)|touch-action:\s*none/);
  assert.match(css, /background: linear-gradient\(135deg, #ffffff2e, #ffffff0a 65%\), #0000001a/);
  assert.match(css, /backdrop-filter: blur\(12px\) saturate\(112%\)/);
});

function luminance(hex) {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('primary text, muted text and gold controls keep readable contrast on actual surfaces', () => {
  for (const surface of ['111416', '1c2023', '24292d']) {
    for (const ink of ['f5f7f4', 'b9beba', 'f9d447']) assert.ok(contrast(ink, surface) >= 4.5);
  }
  assert.ok(contrast('171a1c', 'e4c67e') >= 7);
});

test('dark card labels remain readable through the translucent yellow glass and stat surfaces', () => {
  const blend = (front, back, alpha) => [0, 2, 4].map(index => Math.round(parseInt(front.slice(index, index + 2), 16) * alpha
    + parseInt(back.slice(index, index + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
  const base = blend('000000', 'f9d447', 26 / 255);
  for (const frost of [10 / 255, 46 / 255]) {
    const glass = blend('ffffff', base, frost);
    for (const surface of [glass, blend('000000', glass, 15 / 255)]) {
      for (const ink of ['171b19', '343d31']) assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${surface}`);
    }
  }
});
