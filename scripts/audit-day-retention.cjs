const puppeteer = require('puppeteer');
const { readFile, mkdir } = require('node:fs/promises');
const { resolve, join, extname, sep } = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = process.env.QA_OUTPUT_DIR;
  if (output) await mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const [origin, root] of [['https://koratv.click', resolve(__dirname, '..', process.env.QA_BUILT_SITE ? '_site' : '.')], ['https://fraja.online', resolve(__dirname, '../../foottv6', process.env.QA_BUILT_SITE ? '_site' : '.')]]) {
      for (const width of [390, 1366]) {
        const page = await browser.newPage(), errors = []; let requests = 0, omit = false;
        await page.setViewport({ width, height: 900 }); page.on('pageerror', error => errors.push(error.message));
        await page.evaluateOnNewDocument(() => {
          const OriginalDate = Date; window.qaNow = OriginalDate.parse('2026-10-04T22:59:56Z');
          window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [window.qaNow])); } static now() { return window.qaNow; } };
        });
        const ended = { matchId: 'ended-today', homeTeam: 'Real Madrid', awayTeam: 'Barcelona', league: 'La Liga', scheduledAt: '2026-10-04T14:00:00Z', status: 'FT', playbackState: 'ended', score: '2 - 1' };
        const next = { ...ended, matchId: 'new-day', scheduledAt: '2026-10-05T14:00:00Z', status: 'FIXTURE', playbackState: 'upcoming', score: 'VS' };
        await page.setRequestInterception(true);
        page.on('request', async request => {
          try {
            const url = new URL(request.url());
            if (url.pathname === '/api/matches') {
              requests++;
              return await request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ matches: omit ? [next] : [ended, next] }) });
            }
            if (url.origin === origin) {
              if (process.env.QA_LIVE_SITE) return await request.continue();
              const relative = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
              const file = resolve(root, '.' + relative); if (!file.startsWith(root + sep)) return await request.abort();
              const body = await readFile(file);
              return await request.respond({ status: 200, contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(file)] || 'application/octet-stream', body });
            }
            await request.abort();
          } catch { await request.abort().catch(() => {}); }
        });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#featured-matches [data-match-id="ended-today"]');
        omit = true; await page.evaluate(() => window.refreshLiveMatches());
        assert.ok(await page.$('#featured-matches [data-match-id="ended-today"]'));
        assert.match(await page.$eval('#featured-matches [data-match-id="ended-today"]', node => node.textContent), /انتهت/);
        if (output) await page.screenshot({ path: join(output, `retention-before-${new URL(origin).hostname}-${width}.png`), fullPage: true });
        await page.evaluate(() => window.qaNow = Date.parse('2026-10-04T23:00:00Z'));
        await page.waitForSelector('#featured-matches [data-match-id="new-day"]', { timeout: 10000 });
        assert.equal(await page.$('#featured-matches [data-match-id="ended-today"]'), null);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.ok(requests >= 3); assert.deepEqual(errors, []);
        if (output) await page.screenshot({ path: join(output, `retention-after-${new URL(origin).hostname}-${width}.png`), fullPage: true });
        console.log(JSON.stringify({ origin, width, completedMatchRetainedOnOmission: true, automaticMidnightReplacement: true, overflow: false }));
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
