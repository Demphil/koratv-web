const puppeteer = require('puppeteer');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const [origin, root] of [['https://koratv.click', path.resolve(__dirname, '..')],
      ['https://fraja.online', path.resolve(__dirname, '../../foottv6')]]) {
      for (const width of [320, 390, 1366]) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 900 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', async request => {
          const url = new URL(request.url());
          try {
            if (url.pathname === '/api/matches') {
              const kickoff = new Date(Date.now() - 240 * 60_000).toISOString();
              const fixture = { homeTeam: 'Real Madrid', awayTeam: 'Barcelona', scheduledAt: kickoff,
                league: 'La Liga', score: '0 - 0', channelName: 'beIN SPORTS HD 1', sourceAvailable: true };
              return await request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ matches: [
                  { ...fixture, matchId: 'prolonged-live', status: 'P', playbackState: 'ended', isLive: false, liveMinute: 120 },
                  { ...fixture, matchId: 'confirmed-ended', awayTeam: 'Atletico Madrid', status: 'PEN', playbackState: 'live', isLive: true }
                ] }) });
            }
            if (url.origin === origin) {
              const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
              if (!file.startsWith(root + path.sep)) return await request.abort();
              const body = await readFile(file);
              const ext = path.extname(file);
              const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
                '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream';
              return await request.respond({ status: 200, contentType, body });
            }
            return await request.abort();
          } catch { return request.abort().catch(() => {}); }
        });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#featured-matches [data-secure-match-id="prolonged-live"]', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 500));
        const result = await page.evaluate(() => {
          const live = document.querySelector('#featured-matches article[data-match-id="prolonged-live"]');
          const ended = document.querySelector('#featured-matches article[data-match-id="confirmed-ended"]');
          return { liveText: live?.innerText, endedText: ended?.innerText,
            liveLink: (live?.closest('[data-secure-match-id]') || live?.querySelector('[data-secure-match-id]'))?.href,
            endedClickable: Boolean(ended?.closest('[data-secure-match-id]') || ended?.querySelector('[data-secure-match-id]')),
            cardFits: live?.getBoundingClientRect().width <= innerWidth,
            pageOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.match(result.liveText, /جارية/);
        assert.doesNotMatch(result.liveText, /نهاية المباراة|انتهت/);
        assert.match(result.liveLink, /fabor\.sbs\/739184\.html\?match=prolonged-live/);
        assert.match(result.endedText, /انتهت/);
        assert.equal(result.endedClickable, false);
        assert.equal(result.cardFits, true);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ origin, width, prolongedMatchLive: true, finalMatchClosed: true,
          cardFits: result.cardFits, pageOverflow: result.pageOverflow }));
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
