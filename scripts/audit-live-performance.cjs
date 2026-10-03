const puppeteer = require('puppeteer');
const path = require('node:path');
const fs = require('node:fs/promises');

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const output = path.resolve(__dirname, '../streaming-gateway/dist/qa-live');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    let watchUrl = '';
    for (const host of ['koratv.click', 'fraja.online']) {
      for (const width of [1366, 390]) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setUserAgent(ua);
        await page.setViewport({ width, height: 900 });
        await page.setCacheEnabled(false);
        let matchRequests = 0;
        page.on('request', request => { if (new URL(request.url()).pathname === '/api/matches') matchRequests++; });
        await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.match-card-link', { timeout: 12000 });
        const metrics = await page.evaluate(() => ({
          cardsMs: Math.round(performance.now()), cards: document.querySelectorAll('.match-card-link').length,
          fcpMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
          overflow: document.documentElement.scrollWidth > innerWidth,
          player: [...document.querySelectorAll('.match-card-link.clickable')].find(link => link.textContent.includes('كرواتيا'))?.querySelector('a[data-secure-match-id]')?.href
            || [...document.querySelectorAll('a.match-card-link.clickable')].find(link => link.textContent.includes('كرواتيا'))?.href,
        }));
        if (metrics.player) watchUrl = metrics.player;
        await page.screenshot({ path: path.join(output, `${host}-${width}.png`) });
        console.log(JSON.stringify({ host, width, matchRequests, ...metrics }));
        await context.close();
      }
    }
    if (!watchUrl) throw new Error('No prepared live Croatia fixture is available for playback verification');
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(ua);
    await page.setViewport({ width: Number(process.env.PLAYER_TEST_WIDTH || 1366), height: 900 });
    const media = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (['/api/stream.m3u8', '/api/resource', '/api/generate-token', '/api/redeem-token'].includes(url.pathname)) {
        media.push({ path: url.pathname, status: response.status() });
      }
    });
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => { const video = document.querySelector('video'); video.muted = true; video.play().catch(() => {}); });
    const state = () => page.evaluate(() => {
      const video = document.querySelector('video');
      return { ms: Math.round(performance.now()), time: video.currentTime, paused: video.paused,
        ready: video.readyState, frames: video.getVideoPlaybackQuality?.().totalVideoFrames || 0,
        buffered: video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0,
        status: document.querySelector('#status')?.textContent.trim() || '' };
    });
    try {
      await page.waitForFunction(() => document.querySelector('video')?.getVideoPlaybackQuality?.().totalVideoFrames > 0, { timeout: 40000 });
      console.log(JSON.stringify({ playerFirstFrame: await state() }));
      for (let i = 0; i < Number(process.env.PLAYER_TEST_SAMPLES || 6); i++) {
        await new Promise(resolve => setTimeout(resolve, 15000));
        console.log(JSON.stringify({ playerSample: await state() }));
      }
    } catch {
      console.log(JSON.stringify({ playerFailure: await state() }));
      process.exitCode = 1;
    }
    await page.screenshot({ path: path.join(output, 'player-live.png') });
    console.log(JSON.stringify({ requests: media.reduce((counts, item) => {
      const key = `${item.path}:${item.status}`; counts[key] = (counts[key] || 0) + 1; return counts;
    }, {}) }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
