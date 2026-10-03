const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const privatePaths = ['/streaming-gateway/app.js', '/secure-streaming/scripts/sync-matches-from-source.js',
  '/64b5f9a890.php', '/package.json', '/manual-match-selection.json', '/.env', '/assets/js/api.js.map'];

(async () => {
  for (const origin of ['https://koratv.click', 'https://fraja.online']) {
    for (const path of privatePaths) {
      const response = await fetch(origin + path + '?publication-audit=20261003');
      await response.arrayBuffer();
      assert.equal(response.status, 404, origin + path);
    }
    const response = await fetch(origin + '/assets/js/api.js?publication-audit=20261003');
    const source = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(source, /sourceMappingURL|sb_secret_|BEGIN .*PRIVATE KEY/);
    assert.ok(source.split('\n').length <= 3);
    console.log(JSON.stringify({ origin, privatePathsBlocked: privatePaths.length, minifiedApi: true }));
  }
  for (const path of ['/EMBED-README.md', '/headers.txt', '/player.js.map', '/.env', '/64b5f9a890.php']) {
    const response = await fetch('https://fabor.sbs' + path + '?publication-audit=20261003');
    await response.arrayBuffer();
    assert.equal(response.status, 404, path);
  }
  const source = await (await fetch('https://fabor.sbs/player.js?publication-audit=20261003')).text();
  assert.doesNotMatch(source, /sourceMappingURL/);
  assert.ok(source.split('\n').length <= 3);
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const origin of ['https://koratv.click', 'https://fraja.online']) {
      for (const width of [1366, 390]) {
        const page = await browser.newPage();
        await page.setUserAgent(ua);
        await page.setViewport({ width, height: 900 });
        await page.setCacheEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com|quge5\.com|profitablerate/.test(request.url())
          ? request.abort() : request.continue());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.match-card', { timeout: 20000 });
        const state = await page.evaluate(() => ({
          cards: document.querySelectorAll('.match-card').length,
          overflow: document.documentElement.scrollWidth > innerWidth
        }));
        assert.deepEqual(errors, []);
        assert.equal(state.overflow, false);
        console.log(JSON.stringify({ origin, width, ...state }));
        await page.close();
      }
    }
    for (const path of ['/739184.html', '/watch.html']) {
      const page = await browser.newPage();
      await page.setUserAgent(ua);
      await page.setViewport({ width: 390, height: 844 });
      await page.setRequestInterception(true);
      page.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/.test(request.url())
        ? request.abort() : request.continue());
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('https://fabor.sbs' + path + '?match=12656687994279500871', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof currentMatchInfo !== 'undefined' && currentMatchInfo?.events?.length > 0);
      assert.deepEqual(errors, []);
      const state = await page.evaluate(() => ({ fixture: currentMatchInfo.sourceFixtureId,
        events: currentMatchInfo.events.length, embed: embedSrc(),
        overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(Number(state.fixture), 1640792);
      assert.equal(state.overflow, false);
      assert.equal(new URL(state.embed).pathname, '/watch.html');
      console.log(JSON.stringify({ playerPath: path, ...state }));
      await page.close();
    }
    const parent = await browser.newPage();
    await parent.setUserAgent(ua);
    await parent.setViewport({ width: 390, height: 844 });
    await parent.setRequestInterception(true);
    parent.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/.test(request.url())
      ? request.abort() : request.continue());
    await parent.setContent('<iframe src="https://fabor.sbs/watch.html?match=12656687994279500871" allow="autoplay; fullscreen" style="width:100%;height:600px"></iframe>');
    const frame = await (await parent.$('iframe')).contentFrame();
    await frame.waitForFunction(() => typeof currentMatchInfo !== 'undefined' && currentMatchInfo?.events?.length > 0);
    const framed = await frame.evaluate(() => ({ embedded: self !== top, fixture: currentMatchInfo.sourceFixtureId,
      events: currentMatchInfo.events.length, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(framed.embedded, true);
    assert.equal(Number(framed.fixture), 1640792);
    assert.equal(framed.overflow, false);
    console.log(JSON.stringify({ mobileIframe: framed }));
    await parent.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
