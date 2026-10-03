const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '../streaming-gateway/dist');
const output = path.join(root, 'qa-live-updates');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(400).end(); return; }
    try {
      const data = await fs.readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const width of [1366, 390, 320]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setUserAgent(ua);
      await page.setViewport({ width, height: 900 });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      let detailCalls = 0;
      const forbidden = [], errors = [];
      const match = { matchId: 'unassigned-test', playbackState: 'live', sourceReady: false, resourceStatus: 'WAITING',
        homeTeam: 'السعودية', awayTeam: 'قطر', score: '0 - 0', liveMinute: 83, league: 'كأس الخليج',
        homeLogo: `${base}/flag-morocco.png`, awayLogo: `${base}/flag-morocco.png`,
        events: [{ minute: 79, player: 'لاعب المباراة', team: 'السعودية', detail: 'تبديل' }], eventDetailsLoaded: true };
      await page.setRequestInterception(true);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/match-info') {
          detailCalls++;
          assert.equal(url.searchParams.get('matchId'), match.matchId);
          request.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ match }) });
        } else if (/^\/api\/(generate-token|redeem-token|stream\.m3u8|resource|pool-heartbeat)$/.test(url.pathname)) {
          forbidden.push(url.pathname); request.abort();
        } else if (url.origin !== base) {
          request.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"articles":[],"news":[]}' });
        } else request.continue();
      });
      const playerUrl = `${base}/739184.html?match=${match.matchId}`;
      await page.goto(playerUrl, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.live-updates-card');
      assert.equal(await page.$eval('#match-panel', element => element.hidden), false);
      assert.match(await page.$eval('#status', element => element.textContent), /الثماني/);
      assert.match(await page.$eval('#match-api-detail', element => element.textContent), /لاعب المباراة/);
      const metrics = await page.evaluate(() => {
        const card = document.querySelector('.live-updates-card').getBoundingClientRect();
        const region = document.querySelector('#player-container').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          fits: card.top >= region.top && card.bottom <= region.bottom && card.left >= region.left && card.right <= region.right };
      });
      assert.equal(metrics.overflow, false); assert.equal(metrics.fits, true);
      await page.screenshot({ path: path.join(output, `standalone-${width}.png`), fullPage: true });
      await page.click('.live-updates-jump');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'match-panel');
      match.sourceReady = true; match.resourceStatus = 'ASSIGNED';
      await page.evaluate(() => loadMatchPanel(activeMatchId));
      await page.waitForSelector('#open-ready-stream');
      assert.deepEqual(forbidden, []);
      assert.deepEqual(errors, []);
      match.sourceReady = false; match.resourceStatus = 'WAITING';
      await page.setContent(`<iframe src="${playerUrl}" style="width:100%;height:650px;border:0"></iframe>`);
      const frame = await (await page.waitForSelector('iframe')).contentFrame();
      await frame.waitForSelector('.live-updates-card');
      assert.equal(await frame.$eval('#match-panel', element => getComputedStyle(element).display !== 'none'), true);
      assert.equal(await frame.$eval('body', element => element.classList.contains('tamper-lock')), false);
      await page.screenshot({ path: path.join(output, `embedded-${width}.png`), fullPage: true });
      assert.deepEqual(forbidden, []);
      console.log(JSON.stringify({ width, detailCalls, ...metrics, providerRequests: forbidden.length, embeddedPanelVisible: true }));
      await context.close();
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
