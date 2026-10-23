const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const root = path.resolve(__dirname, '..');
const fraja = fs.readFileSync(path.join(root, 'CNAME'), 'utf8').includes('fraja.online');
test('adapter loads before the original ad tags with this site zones and mobile rollout off', () => {
  const pages = fraja ? ['index.html', 'news.html', 'usecase.html', 'abroad/index.html', 'at-work/index.html', 'low-internet/index.html', 'smart-tv/index.html'] : ['index.html', 'news.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const $ = load(html);
    const adapter = $('script[src*="/assets/js/monetag-window.js"]');
    assert.equal(adapter.length, 1, page);
    assert.equal(adapter.attr('data-mobile-swap'), 'off');
    assert.equal(adapter.attr('data-zones'), fraja ? '11865231,11865230' : '11820367');
    assert.equal(adapter.attr('data-desktop'), 'chrome-windows');
    assert.ok(html.indexOf('/assets/js/monetag-window.js') < html.indexOf(fraja ? '/assets/js/site-ads.js' : 'https://quge5.com/88/tag.min.js'));
  }
});
test('safe UI state is registered directly without synthetic clicks or copying arbitrary inputs', () => {
  const news = fs.readFileSync(path.join(root, 'assets/js/news.js'), 'utf8');
  const matches = fs.readFileSync(path.join(root, 'assets/js/matches.js'), 'utf8');
  assert.match(news, /PublisherAdWindow\?\.register\('news'/);
  assert.match(news, /applyFilter\(saved.filter\)/);
  assert.match(matches, /PublisherAdWindow\?\.register\('matches'/);
  assert.match(matches, /loadAndRenderMatches\(\).then\(registerMatchState\)/);
  assert.doesNotMatch(news + matches, /dispatchEvent\(new MouseEvent|\.click\(\)/);
});
test('original direct-ad cooldown and noopener/noreferrer remain intact', () => {
  const source = fs.readFileSync(path.join(root, fraja ? 'assets/js/site-ads.js' : 'streaming-gateway/player/player.html'), 'utf8');
  assert.match(source, /5 \* 60 \* 1000/);
  assert.match(source, /'noopener,noreferrer'/);
  assert.match(source, /PublisherAdWindow\?\.openDirect/);
  assert.match(source, new RegExp(fraja ? '11865233' : '11949902'));
});
test('shared viewing page uses the same adapter and never opts into tab replacement', { skip: fraja }, () => {
  const html = fs.readFileSync(path.join(root, 'streaming-gateway/player/player.html'), 'utf8');
  const $ = load(html);
  const adapter = $('script[src="./monetag-window.js"]');
  assert.equal(adapter.attr('data-zones'), '11949898');
  assert.equal(adapter.attr('data-mode'), 'player');
  assert.equal(adapter.attr('data-mobile-swap'), 'off');
  assert.equal(adapter.attr('data-direct-url'), 'https://omg10.com/4/11949902');
  const build = fs.readFileSync(path.join(root, 'streaming-gateway/scripts/build-player.js'), 'utf8');
  assert.match(build, /cp\('\.\.\/assets\/js\/monetag-window.js', 'dist\/monetag-window.js'\)/);
});
