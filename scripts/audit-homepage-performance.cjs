const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, join, extname, sep } = require('node:path');

(async () => {
  const live = process.argv.includes('--live');
  const sites = process.argv.includes('--kora-only') ? ['koratv.click'] : ['koratv.click', 'fraja.online'];
  const output = resolve('streaming-gateway/dist/qa-performance');
  await mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  const results = [];
  try {
    for (const site of sites) for (const width of [390, 1366]) {
      const root = resolve(site === 'koratv.click' ? '_site' : '../foottv6/_site');
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width, height: 900 });
      await page.evaluateOnNewDocument(() => {
        window.qaShifts = [];
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.qaShifts.push({ value: entry.value,
            nodes: entry.sources.map(source => source.node?.className || source.node?.nodeName) });
        }).observe({ type: 'layout-shift', buffered: true });
      });
      if (!live) {
        await page.setRequestInterception(true);
        page.on('request', async request => {
          try {
            const url = new URL(request.url());
            if (url.hostname !== site) return await request.continue();
            const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + sep)) return await request.abort();
            const body = await readFile(file);
            await request.respond({ status: 200, contentType: ({ '.html': 'text/html', '.js': 'application/javascript',
              '.mjs': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2',
              '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream', body });
          } catch { await request.abort().catch(() => {}); }
        });
      }
      await page.goto(`https://${site}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#featured-matches')?.dataset.matchSignature !== undefined);
      await page.evaluate(() => document.fonts.ready);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const result = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        cards: document.querySelectorAll('#featured-matches [data-match-id]').length,
        logoLoaded: document.querySelector('.header .logo img')?.naturalWidth > 0,
        localFontLoaded: document.fonts.check('700 16px Cairo'),
        shifts: window.qaShifts,
        resources: performance.getEntriesByType('resource').filter(r => /fonts|logo/.test(r.name)).map(r => ({url:r.name, bytes:r.transferSize}))
      }));
      await page.evaluate(() => { window.qaFirstCard = document.querySelector('#featured-matches > :first-child'); });
      await page.evaluate(() => window.refreshLiveMatches());
      result.stableRefresh = await page.evaluate(() => window.qaFirstCard === document.querySelector('#featured-matches > :first-child'));
      assert.equal(result.overflow, false);
      assert.equal(result.logoLoaded, true);
      assert.equal(result.localFontLoaded, true);
      assert.equal(result.stableRefresh, true);
      await page.screenshot({ path: join(output, `${site}-${width}-${live ? 'live' : 'local'}.png`), fullPage: false });
      results.push({ site, width, live, ...result, errors });
      console.log(JSON.stringify(results.at(-1)));
      await page.close();
    }
    await writeFile(join(output, live ? 'live.json' : 'local.json'), JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
