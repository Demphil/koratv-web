const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const output = path.resolve(__dirname, '../streaming-gateway/dist/qa-live-updates-production');

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
        const feed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/matches' && response.ok());
        await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const { matches } = await (await feed).json();
        const candidates = matches.filter(match => match.playbackState === 'live' && !match.sourceReady)
          .sort((a, b) => Number(b.resourceStatus === 'WAITING') - Number(a.resourceStatus === 'WAITING') || (b.events?.length || 0) - (a.events?.length || 0));
        await page.waitForSelector('[data-secure-match-id]', { timeout: 15000 });
        let selected, link;
        for (const match of candidates) {
          link = await page.evaluate(id => [...document.querySelectorAll('a[data-secure-match-id]')]
            .find(element => decodeURIComponent(element.dataset.secureMatchId) === id)?.href, match.matchId);
          if (link) { selected = match; break; }
        }
        assert.ok(link, 'a current unprepared live match must have a player link');
        assert.equal(new URL(link).searchParams.get('match'), selected.matchId);
        const requests = [], errors = [];
        page.on('request', request => {
          const pathname = new URL(request.url()).pathname;
          if (/^\/api\/(generate-token|redeem-token|stream\.m3u8|resource|pool-heartbeat)$/.test(pathname)) requests.push(pathname);
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.live-updates-card', { timeout: 15000 });
        await page.waitForFunction(() => currentMatchInfo && !document.querySelector('#match-panel').hidden);
        const initial = await page.evaluate(() => ({
          matchId: currentMatchInfo.matchId, resourceStatus: currentMatchInfo.resourceStatus,
          state: currentMatchInfo.playbackState, events: currentMatchInfo.events.length,
          visibleMs: Math.round(performance.now()), overflow: document.documentElement.scrollWidth > innerWidth,
          message: document.querySelector('.live-updates-card p').textContent,
        }));
        assert.equal(initial.matchId, selected.matchId);
        assert.equal(initial.overflow, false);
        if (initial.resourceStatus === 'WAITING') assert.match(initial.message, /الثماني/);
        await page.screenshot({ path: path.join(output, `${host}-${width}.png`), fullPage: true });
        await page.click('.live-updates-jump');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'match-panel');
        await new Promise(resolve => setTimeout(resolve, 17000));
        const refreshed = await page.evaluate(() => ({ requests: matchPanelRequestSequence, matchId: currentMatchInfo.matchId }));
        assert.ok(refreshed.requests >= 2, 'live metadata must refresh');
        assert.equal(refreshed.matchId, initial.matchId);
        assert.deepEqual(requests, [], 'text coverage must not allocate streaming resources');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ host, width, ...initial, metadataRequests: refreshed.requests, providerRequests: requests.length }));
        await context.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
