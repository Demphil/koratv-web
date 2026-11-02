const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { rewriteHtml } = require('./migrate-korafabor.cjs');
const css = fs.readFileSync(path.join(__dirname, '../assets/css/korafabor-theme.css'), 'utf8');

test('gold and white theme is idempotent across public page types and keeps mobile repair last before theme', () => {
  for (const route of ['index.html', 'news.html', 'news/example/index.html', 'archive-entry']) {
    const first = rewriteHtml('<head><meta name="theme-color" content="#1d3557"></head><main class="match-detail"><h1>Home 2 - 1 Away</h1></main>', route);
    const $ = load(rewriteHtml(first, route));
    assert.ok($('html').hasClass('korafabor-theme'));
    assert.equal($('link[href*="korafabor-theme.css"]').length, 1);
    assert.equal($('link[rel="stylesheet"]').last().attr('href'), '/assets/css/korafabor-theme.css?v=20261102-gold1');
    assert.equal($('meta[name="theme-color"]').attr('content'), '#15191c');
    assert.equal($('main h1').text(), 'Home 2 - 1 Away');
  }
  const proof = 'google-site-verification: google4c7e1aa55a5300ab.html\r\n';
  assert.equal(rewriteHtml(proof, 'google4c7e1aa55a5300ab.html'), proof);
  assert.equal(load(rewriteHtml('<head><title>Article</title></head>', 'news/example/index.html'))('meta[name="theme-color"]').attr('content'), '#15191c');
});

test('site theme leaves app identity, team assets, status badges and streaming behavior alone', () => {
  assert.doesNotMatch(css, /\.app-promotion|\.showcase|\.card-dot|\.live-badge|\.team\s+img|\/api\/|url\(/);
  assert.match(css, /--kf-gold: #e4c67e/);
  assert.match(css, /--kf-white: #f5f7f4/);
  assert.match(css, /--match-viewport-background: var\(--kf-backdrop\)/);
  assert.match(css, /background-attachment: scroll/);
  assert.doesNotMatch(css, /overflow(?:-y)?:\s*(?:hidden|clip)|touch-action:\s*none/);
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
    for (const ink of ['f5f7f4', 'b9beba', 'e4c67e']) assert.ok(contrast(ink, surface) >= 4.5);
  }
  assert.ok(contrast('171a1c', 'e4c67e') >= 7);
});
