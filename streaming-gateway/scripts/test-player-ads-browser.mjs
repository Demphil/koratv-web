import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.PLAYWRIGHT_MODULES || process.cwd()] }));
const root = resolve('dist');
const nginx = await readFile('nginx.conf.example', 'utf8');
const policies = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map((match) => match[1]);
const config = JSON.parse(await readFile('player/ads-config.json', 'utf8'));
config.click.providers = [{ name: 'fixture', enabled: true, url: 'https://ads.example.test/direct' }];
config.display = [{ enabled: true, slot: 'footer', height: 120, script_url: 'https://ads.example.test/probe.js' }];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = join(root, path === '/' ? '739184.html' : path);
  if (!file.startsWith(root + '\\') && file !== root && !file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
  try {
    const body = path === '/ads-config.json' ? JSON.stringify(config) : await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': path === '/ad-frame.html' ? policies[1] : policies[0],
      'Cache-Control': 'no-store',
    }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: true });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url === 'https://ads.example.test/probe.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `
        const result = {};
        try { top.location.href = 'https://ads.example.test/hijacked'; result.top = false; } catch { result.top = true; }
        try { parent.location.replace('https://ads.example.test/hijacked'); result.replace = false; } catch { result.replace = true; }
        try { parent.document.body.textContent = 'hijacked'; result.dom = false; } catch { result.dom = true; }
        result.popup = !window.open('https://ads.example.test/uncontrolled', '_blank');
        parent.postMessage({ type: 'sandbox-probe', result }, '*');
      ` });
    }
    if (url === 'https://ads.example.test/direct') return route.fulfill({ contentType: 'text/html', body: '<title>Test ad only</title>' });
    return route.abort();
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.adProbe = null;
    window.addEventListener('message', (event) => { if (event.data?.type === 'sandbox-probe') window.adProbe = event.data.result; });
  });
  const start = Date.now();
  await page.goto(base + '/739184.html');
  assert.equal(await page.locator('.ad-slot iframe').count(), 0);
  const startVideo = async () => page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      ctx.fillStyle = '#187746'; ctx.fillRect(0, 0, 1280, 720);
      ctx.strokeStyle = '#d3eed3'; ctx.lineWidth = 3;
      ctx.strokeRect(55, 50, 1170, 620); ctx.beginPath(); ctx.moveTo(640, 50); ctx.lineTo(640, 670); ctx.stroke();
      ctx.beginPath(); ctx.arc(640, 360, 110, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(300 + performance.now() / 20 % 500, 420, 9, 0, Math.PI * 2); ctx.fill();
      requestAnimationFrame(draw);
    }; draw();
    const video = document.getElementById('video'); video.muted = true;
    video.srcObject = canvas.captureStream(24); await video.play();
    document.getElementById('status').hidden = true;
  });
  await startVideo();
  await page.locator('.ad-click-shield').waitFor();
  const originalUrl = page.url();
  const popupPromise = context.waitForEvent('page');
  await page.locator('.ad-click-shield').tap({ position: { x: 130, y: 110 } });
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(await popup.evaluate(() => window.opener === null), true);
  assert.equal(page.url(), originalUrl);
  assert.equal(await page.locator('.ad-click-shield').count(), 0);
  await popup.close();
  await page.waitForFunction(() => window.adProbe !== null, null, { timeout: 20000 });
  assert.ok(Date.now() - start >= 14500, 'display scripts must wait 15 seconds');
  assert.deepEqual(await page.evaluate(() => window.adProbe), { top: true, replace: true, dom: true, popup: true });
  assert.equal(page.url(), originalUrl);
  const artifacts = resolve('dist/qa'); await mkdir(artifacts, { recursive: true });
  async function geometry(label) {
    const result = await page.evaluate(() => {
      const host = document.getElementById('video-picture-overlay').getBoundingClientRect();
      const brand = document.querySelector('.picture-brand').getBoundingClientRect();
      const video = document.getElementById('video');
      return { ratio: host.width / host.height, right: (host.right - brand.right) / host.width,
        top: (brand.top - host.top) / host.height, width: brand.width / host.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        playerWidth: document.getElementById('player-container').clientWidth,
        time: video.currentTime, readyState: video.readyState, frames: video.getVideoPlaybackQuality().totalVideoFrames };
    });
    assert.ok(Math.abs(result.ratio - 16 / 9) < 0.02, label);
    assert.ok(Math.abs(result.right - 0.035) < 0.01, label);
    assert.ok(Math.abs(result.top - 0.06) < 0.01, label);
    assert.ok(!result.overflow, label);
    if (label === 'desktop') assert.ok(result.playerWidth > 1000, 'ads must not squeeze the player');
    assert.ok(result.time > 0 && result.readyState >= 2 && result.frames > 0, label);
    await page.screenshot({ path: join(artifacts, `${label}.png`), fullPage: false });
    console.log(label, JSON.stringify(result));
  }
  await geometry('desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200); await geometry('mobile');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await page.bringToFront();
  await page.locator('.plyr').hover();
  await page.locator('[data-plyr="fullscreen"]').focus();
  await page.locator('[data-plyr="fullscreen"]').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(200); await geometry('fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await page.reload(); await startVideo(); await page.waitForTimeout(300);
  assert.equal(await page.locator('.ad-click-shield').count(), 0, 'reload respects cooldown');
  console.log('PASS: isolated ad navigation, no opener, 15s delay, cooldown, responsive video anchors');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
