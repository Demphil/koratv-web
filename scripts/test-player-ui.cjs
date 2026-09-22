const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

// Exercise the real controls with deterministic media and API fixtures.
const root = path.resolve(__dirname, '../streaming-gateway/dist');
const fakeHls = `class Hls {
  static isSupported() { return true; }
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  constructor() { this.handlers = {}; this.levels = [480,720,1080].map(height => ({height})); window.testHls = this; }
  on(event, fn) { this.handlers[event] = fn; }
  loadSource() {}
  attachMedia(video) { if (!window.fixtureStall) setTimeout(() => { this.handlers.manifest(); video.dispatchEvent(new Event('canplay')); }, 30); }
  destroy() {} startLoad() {} recoverMediaError() {}
}`;

(async () => {
  const server = http.createServer(async (req, res) => {
    const filename = new URL(req.url, 'http://localhost').pathname;
    try {
      const target = path.join(root, path.basename(filename));
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(target)] || 'text/plain');
      res.end(await fs.readFile(target));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const width of [1366, 390]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let redeemed = 0;
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = request.url();
        if (url.endsWith('/config.js')) return request.respond({ contentType: 'text/javascript', body: `const STREAM_API_ORIGIN = 'http://127.0.0.1:${server.address().port}';` });
        if (url.endsWith('/hls.min.js')) return request.respond({ contentType: 'text/javascript', body: fakeHls });
        if (url.includes('/api/redeem-token')) {
          redeemed += 1;
          return request.respond({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ token: 'fixture-session', expiresIn: 3600, qualities: [] }) });
        }
        if (url.includes('/api/match-info')) return request.respond({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ match: { homeTeam: 'الفريق الأول', awayTeam: 'الفريق الثاني', score: '2 - 1', liveMinute: 37, playbackState: 'live', yellowCards: {home: 2, away: 1}, redCards: {home: 0, away: 1}, goals: [{player: 'لاعب المباراة', minute: 25}] } }) });
        if (url.startsWith('http://127.0.0.1:')) return request.continue();
        if (request.resourceType() === 'script') return request.respond({ contentType: 'text/javascript', body: '' });
        return request.respond({ contentType: 'application/json', body: '{"items":[]}' });
      });
      const ticket = `a.${Buffer.from(JSON.stringify({matchId:'fixture-match'})).toString('base64url')}.c`;
      await page.goto(`http://127.0.0.1:${server.address().port}/watch.html?k=${ticket}`);
      await page.waitForSelector('.plyr__controls', {timeout: 10000}).catch(async error => {
        console.log(await page.$eval('#status', el => el.textContent), errors);
        throw error;
      });
      await page.waitForSelector('[data-plyr="quality"][value="1080"]');
      await page.click('[data-plyr="settings"]');
      await page.click('.plyr__control--forward');
      const menu = await page.$eval('.plyr__menu__container', el => el.textContent);
      assert.match(menu, /1080/);
      assert.match(menu, /720/);
      assert.match(menu, /480/);
      assert.equal(await page.$('select'), null);
      assert.equal(await page.$eval('#match-yellow-cards', el => el.textContent), '3');
      assert.equal(await page.$eval('body', el => el.scrollWidth <= innerWidth), true);
      await page.waitForFunction(() => document.querySelector('.plyr__menu__container').getBoundingClientRect().height > 140);
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({ path: path.join(root, `qa-player-${width}.png`) });
      await page.click('[data-plyr="quality"][value="1080"]');
      assert.equal(await page.evaluate(() => testHls.currentLevel), 2);
      await page.reload();
      await page.waitForSelector('.plyr__controls');
      assert.equal(redeemed, 1, 'reload must reuse the tab session, not redeem a consumed ticket');
      await page.evaluate(() => { testHls.handlers.error(null, {fatal:true, type:'other'}); });
      await page.waitForSelector('#retry-stream');
      assert.match(await page.$eval('#status', el => el.textContent), /البث غير متوفر/);
      await page.evaluateOnNewDocument(() => { window.fixtureStall = true; });
      await page.reload();
      await page.waitForSelector('.plyr__controls');
      assert.equal(await page.$('[data-plyr="quality"][value="1080"]'), null);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Player controls, live panel, session reload and error state passed at ${width}px`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
