const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { mkdir } = require('node:fs/promises');
const puppeteer = require('puppeteer');

function playwright() {
  for (const directory of process.env.PATH.split(require('node:path').delimiter)) {
    try { return createRequire(join(directory, '..', 'package.json'))('playwright'); } catch {}
  }
  throw new Error('Run with npm exec --package=playwright -- node scripts/audit-player-depth.cjs');
}

(async () => {
  const { chromium } = playwright();
  const browser = await chromium.launch({ executablePath: await puppeteer.executablePath(), headless: true,
    args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const output = resolve(__dirname, '../streaming-gateway/dist/qa-depth');
  await mkdir(output, { recursive: true });
  try {
    const data = await (await fetch('https://stream-api.koratv.click/api/matches?day=today', { headers: { Origin: 'https://koratv.click' } })).json();
    const rows = Array.isArray(data) ? data : data.matches || [];
    const live = rows.find(row => row.playbackState === 'live' && row.sourceReady);
    const url = process.env.PLAYER_TEST_URL || `https://fabor.sbs/739184.html${live ? `?match=${encodeURIComponent(live.matchId)}` : ''}`;
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Ad delivery remains the provider's responsibility; visual QA must not navigate away.
      await page.route(/omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/, route => route.abort());
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Number(document.querySelector('#page-depth')?.dataset.frames) > 1, { timeout: 20000 });
      const inspect = () => page.evaluate(() => {
        const canvas = document.querySelector('#page-depth');
        const gl = canvas.getContext('webgl2');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let lit = 0, checksum = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) { lit++; checksum += pixels[i] + pixels[i + 1] + pixels[i + 2] + pixels[i + 3]; }
        return { lit, checksum, frames: Number(canvas.dataset.frames), overflow: document.documentElement.scrollWidth > innerWidth,
          background: getComputedStyle(document.body).backgroundImage, panel: getComputedStyle(document.querySelector('#match-panel')).backgroundImage,
          playerTransform: getComputedStyle(document.querySelector('#player-container')).transform };
      });
      const before = await inspect();
      await page.mouse.move(width - 10, 30);
      await page.waitForTimeout(1500);
      const after = await inspect();
      assert.ok(after.lit > 100, 'background canvas must render visible geometry');
      assert.ok(after.frames > before.frames, 'background must render additional frames');
      assert.notEqual(after.checksum, before.checksum, 'pointer motion must change the background');
      assert.equal(after.overflow, false, 'page must fit the viewport');
      assert.equal(after.playerTransform, 'none', '3D must not transform the video');
      assert.match(after.panel, /gradient/);
      await page.screenshot({ path: join(output, `player-${width}.png`), fullPage: true });
      console.log(JSON.stringify({ width, ...after, errors }));
      await page.close();
    }
    if (live) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const ads = [];
      page.on('response', response => {
        const url = new URL(response.url());
        if (['al5sm.com', 'nap5k.com', 'n6wxm.com'].includes(url.hostname)) ads.push({ host: url.hostname, status: response.status() });
      });
      await page.addInitScript(() => { window.__qaPopups = []; window.open = url => { window.__qaPopups.push(url); return null; }; });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('video')?.getVideoPlaybackQuality?.().totalVideoFrames > 10, { timeout: 40000 });
      await page.evaluate(() => document.querySelector('video').pause());
      await page.locator('[data-plyr="play"]').first().click();
      await page.waitForTimeout(2500);
      const adState = await page.evaluate(() => ({
        popups: window.__qaPopups, zones: [...document.querySelectorAll('script[data-koratv-monetag]')].map(script => script.dataset.zone),
        paused: document.querySelector('video').paused,
      }));
      assert.ok(adState.popups.includes('https://omg10.com/4/11949902'));
      assert.ok(adState.zones.includes('11949898'));
      assert.equal(adState.zones.includes('11908582'), false, 'mobile vignette must stay disabled');
      assert.equal(adState.paused, false, 'Play must still reach the video');
      console.log(JSON.stringify({ mobileAds: adState, sdkResponses: ads }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
