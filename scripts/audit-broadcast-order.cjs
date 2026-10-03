const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');

const output = path.resolve(__dirname, '../streaming-gateway/dist/qa-broadcast-order');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const host of ['koratv.click', 'fraja.online']) {
      for (const width of [1366, 390]) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setUserAgent(ua);
        await page.setViewport({ width, height: 900 });
        await page.setCacheEnabled(false);
        const response = page.waitForResponse(item => new URL(item.url()).pathname === '/api/matches' && item.ok());
        await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const { matches } = await (await response).json();
        await page.waitForSelector('#featured-matches article[data-match-id]', { timeout: 15000 });
        const metrics = await page.evaluate(() => ({
          ids: [...document.querySelectorAll('#featured-matches article[data-match-id]')].map(card => card.dataset.matchId),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        const selected = matches.filter(match => match.resourceStatus === 'ASSIGNED' && match.playbackState !== 'ended' && metrics.ids.includes(match.matchId))
          .sort((a, b) => a.broadcastRank - b.broadcastRank);
        assert.ok(selected.length > 0, 'production must expose at least one current selected fixture');
        assert.deepEqual(metrics.ids.slice(0, selected.length), selected.map(match => match.matchId));
        assert.equal(metrics.overflow, false);
        for (const match of selected) {
          assert.ok(match.broadcastRank > 0);
          assert.equal(match.providerId, undefined);
        }
        await page.screenshot({ path: path.join(output, `${host}-${width}.png`) });
        console.log(JSON.stringify({ host, width, reservedAtTop: selected.length, ranks: selected.map(match => match.broadcastRank), overflow: metrics.overflow }));
        await context.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
