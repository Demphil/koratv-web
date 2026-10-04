const express = require('../streaming-gateway/node_modules/express');
const puppeteer = require('puppeteer');
const { mkdtemp, rm, mkdir, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const root = resolve(__dirname, '..');
  const playerRoot = join(root, 'streaming-gateway', process.env.QA_BUILT_PLAYER ? 'dist' : 'player');
  const { registerOperatorConsole } = await import(pathToFileURL(join(root, 'streaming-gateway/operator-console.js')));
  const { hashOperatorPassword } = await import(pathToFileURL(join(root, 'streaming-gateway/operator-auth.js')));
  const { publicMatchId } = await import(pathToFileURL(join(root, 'shared/public-match-id.mjs')));
  const dir = await mkdtemp(join(tmpdir(), 'koratv-operator-qa-'));
  const output = process.env.QA_OUTPUT_DIR || dir;
  await mkdir(output, { recursive: true });
  const password = 'local-qa-password-not-production';
  const config = { api: '', operatorConsolePath: '/local-fixture-console', operatorPasswordHash: await hashOperatorPassword(password), operatorControlPath: join(dir, 'state.json'), operatorMediaPath: join(dir, 'media'), providerChannels: () => ({ 'On Sport Plus': { sourceNames: { A: 'EG On Sport Plus HD' } }, 'Arryadia 3 HD': { sourceNames: { B: 'AR Arryadia 3 HD' } } }) };
  const values = new Map();
  const redis = { get: async key => values.get(key), set: async (key, value) => values.set(key, value), del: async key => values.delete(key), incr: async key => { const value = Number(values.get(key) || 0) + 1; values.set(key, value); return value; }, expire: async () => {} };
  const names = [['المغرب','مالي'],['مصر','جنوب أفريقيا'],['ريال مدريد','برشلونة'],['الأرجنتين','بوركينا فاسو'],['هولندا','إيطاليا'],['البرتغال','فرنسا'],['الرجاء الرياضي','نهضة بركان'],['السعودية','قطر'],['إنجلترا','ألمانيا']];
  const matches = names.map(([homeTeam, awayTeam], index) => ({ matchId: index ? `fixture-${index}` : 'fixture', homeTeam, awayTeam, league: index < 2 ? 'المباريات الودية' : 'الدوري الإسباني', status: 'LIVE', isLive: index < 3, sourceReady: index < 8, viewingMode: index < 8 ? 'stream' : 'live-updates', time: '18:00', score: '1 - 0', channelName: index ? 'On Sport Plus' : 'Arryadia 3 HD' }));
  const app = express(); app.use(express.json({ limit: '260kb' }));
  registerOperatorConsole(app, { config, redis, clientIp: () => 'qa', getMatches: async () => matches, prepareChannel: async channel => ({ name: channel }), applyResources: async () => {}, status: () => ({ accounts: Array.from({ length: 8 }, (_, index) => ({ provider: String.fromCharCode(65 + index), status: 'BUSY_STREAMING' })), prewarm: { warmed: 8 } }) });
  app.get('/fixture-control.js', async (req, res) => res.type('js').send(await readFile(join(playerRoot, 'broadcast-control.js'), 'utf8')));
  app.get('/broadcast-notice.js', async (req, res) => res.type('js').send(await readFile(join(playerRoot, 'broadcast-notice.js'), 'utf8')));
  app.get('/fixture.css', async (req, res) => res.type('css').send(await readFile(join(playerRoot, 'player.css'), 'utf8')));
  app.get('/notice.css', async (req, res) => res.type('css').send(await readFile(join(playerRoot, 'broadcast-notice.css'), 'utf8')));
  app.get('/fixture-player', (req, res) => res.type('html').send(`<html dir="rtl"><head><link rel="stylesheet" href="/fixture.css"><link rel="stylesheet" href="/notice.css"></head><body style="margin:0"><div id="player-container" style="position:relative;width:100%;aspect-ratio:16/9;background:#182e24"><video style="width:100%"></video></div><script>const STREAM_API_ORIGIN=${JSON.stringify(config.api)};let activeMatchId='fixture';const embeddedMatchId='fixture';function publicMatchId(){return '${publicMatchId('fixture')}'};window.refreshOperatorPlayback=()=>window.channelRefreshes=(window.channelRefreshes||0)+1;</script><script type="module" src="/fixture-control.js"></script></body></html>`));
  app.get('/embed-test', (req, res) => res.type('html').send('<html><body style="margin:0"><iframe src="/fixture-player" style="border:0;width:100%;aspect-ratio:16/9"></iframe></body></html>'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); config.api = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(config.api + config.operatorConsolePath);
    await page.type('#password', password); await page.click('#login button'); await page.waitForSelector('#workspace:not([hidden])');
    async function checkDepth() {
      await page.bringToFront();
      await page.waitForFunction(() => Number(document.getElementById('operator-depth').dataset.frames) >= 2);
      const pixels = () => page.$eval('#operator-depth', canvas => {
        const gl = canvas.getContext('webgl2'); const bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        let nonblank = 0, hash = 0; for (let i = 0; i < bytes.length; i += 4) { if (bytes[i + 3]) nonblank++; hash = (hash * 31 + bytes[i] + bytes[i + 1] + bytes[i + 2] + bytes[i + 3]) >>> 0; }
        return { nonblank, hash, width: canvas.clientWidth, height: canvas.clientHeight, frames: Number(canvas.dataset.frames) };
      });
      const before = await pixels(); await page.mouse.move(20, 20);
      await page.waitForFunction(previous => Number(document.getElementById('operator-depth').dataset.frames) > previous + 4, {}, before.frames);
      const after = await pixels(); assert.ok(after.nonblank > 100); assert.notEqual(after.hash, before.hash);
      assert.equal(after.width, page.viewport().width); assert.equal(after.height, page.viewport().height);
    }
    await checkDepth();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'operator-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await checkDepth();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'operator-mobile.png'), fullPage: true });
    console.log('console desktop/mobile checked');
    await page.click('[data-view="notices-view"]');
    await page.type('[data-field="title"]', 'KoraScore Ai');
    await page.type('#notice-list textarea', 'نعتذر عن التأخير، تم تجهيز القناة الصحيحة. شكراً لمتابعتكم.');
    for (const [key, value] of [['titleSize', '32'], ['titleColor', '#44cc77'], ['titleAnimation', 'pulse'], ['textAnimation', 'glow'], ['textColor', '#ffffff'], ['duration', '20']]) await page.$eval(`[data-field="${key}"]`, (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await (await page.$('#notice-list input[type=file]')).uploadFile(process.env.QA_NOTICE_IMAGE || join(root, 'streaming-gateway/player/flag-morocco.png'));
    await page.waitForSelector('.editor-image', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#notice-preview-stage .notice-media img').naturalWidth > 0);
    const size = () => page.$eval('#notice-preview-stage .broadcast-notice', card => ({ width: card.offsetWidth, height: card.offsetHeight }));
    const setField = (key, value) => page.$eval(`[data-field="${key}"]`, (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
    await setField('cardScale', 50); const small = await size();
    await setField('cardScale', 150); const large = await size(); assert.ok(large.width > small.width); assert.ok(large.height > small.height);
    await setField('cardScale', 100); await setField('minHeight', 180); assert.ok((await size()).height >= 140);
    await setField('minHeight', 0); await setField('padding', 0);
    assert.equal(await page.$eval('#notice-preview-stage .broadcast-notice', card => getComputedStyle(card).padding), '0px');
    await setField('padding', 10);
    assert.equal(await page.evaluate(async () => {
      const { createNotice, renderNotice } = await import('/api/operator/ui/broadcast-notice.js');
      const container = document.createElement('div'); container.style.cssText = `position:absolute;top:0;left:0;width:${innerWidth}px;height:240px;visibility:hidden;pointer-events:none`; document.body.append(container);
      const view = createNotice(container);
      try {
        for (const [width, height] of [[180, 60], [60, 180], [96, 96]]) {
          const source = document.createElement('canvas'); source.width = width; source.height = height; source.getContext('2d').fillRect(0, 0, width, height);
          const loaded = new Promise(resolve => view.image.addEventListener('load', resolve, { once: true }));
          renderNotice(view, { title: 'Ad', image: source.toDataURL(), design: { imageSize: 160, cardScale: 150 } }); await loaded;
          const media = view.media.getBoundingClientRect(), image = view.image.getBoundingClientRect();
          if (Math.abs(media.width / media.height - width / height) > .01 || Math.abs(media.width - image.width) > .1 || Math.abs(media.height - image.height) > .1) return false;
        }
        return true;
      } finally { container.remove(); }
    }), true);
    await page.setViewport({ width: 1366, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'operator-ad-editor-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.$eval('#notice-duration', node => node.value = '20'); await page.$eval('#notice-interval', node => node.value = '5');
    const viewer = await browser.newPage(); await viewer.setViewport({ width: 390, height: 844 }); await viewer.goto(`${config.api}/embed-test`, { waitUntil: 'domcontentloaded' });
    const frame = viewer.frames().find(frame => frame.url().includes('fixture-player'));
    await frame.waitForSelector('.broadcast-notice', { timeout: 10000 });
    console.log('embed loaded');
    await page.bringToFront(); await page.click('#publish-notices');
    await page.waitForFunction(() => document.getElementById('message').textContent.includes('تم نشر') || document.getElementById('message').classList.contains('error'), { timeout: 10000 });
    console.log('notice submission:', await page.$eval('#message', node => node.textContent));
    await viewer.bringToFront(); await frame.waitForSelector('.broadcast-notice:not([hidden])', { timeout: 10000 });
    await frame.waitForFunction(() => { const image = document.querySelector('.broadcast-notice img'), card = document.querySelector('.broadcast-notice').getBoundingClientRect(); return image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height >= 50 && card.left >= 0 && card.right <= innerWidth; }, { timeout: 10000 }).catch(async error => { console.log(await frame.evaluate(() => { const image = document.querySelector('.broadcast-notice img'), card = document.querySelector('.broadcast-notice'); return { complete: image.complete, natural: image.naturalWidth, image: image.getBoundingClientRect().toJSON(), card: card.getBoundingClientRect().toJSON(), width: innerWidth, animation: getComputedStyle(card).animation }; })); throw error; });
    await viewer.screenshot({ path: join(output, 'operator-embed-notice.png') });
    async function checkImageFrame() {
      const dimensions = await frame.$eval('.notice-media', media => { const image = media.querySelector('img'); return { width: media.offsetWidth, height: media.offsetHeight, imageWidth: image.getBoundingClientRect().width, imageHeight: image.getBoundingClientRect().height, ratio: image.naturalWidth / image.naturalHeight }; });
      assert.ok(Math.abs(dimensions.width / dimensions.height - dimensions.ratio) < .03);
      assert.ok(Math.abs(dimensions.width - dimensions.imageWidth) <= 1); assert.ok(Math.abs(dimensions.height - dimensions.imageHeight) <= 1);
    }
    await checkImageFrame();
    const motion = await frame.evaluate(async () => {
      const card = document.querySelector('.broadcast-notice'), animation = card.getAnimations()[0], positions = [];
      animation.pause();
      for (const fraction of [0, .25, .5, .75, 1]) { animation.currentTime = fraction * 20000; await new Promise(requestAnimationFrame); positions.push(card.getBoundingClientRect().left); }
      const parent = document.getElementById('player-container').getBoundingClientRect(), width = card.getBoundingClientRect().width;
      animation.currentTime = 10000; await new Promise(requestAnimationFrame);
      return { positions, parent: { left: parent.left, right: parent.right }, width, easing: animation.effect.getTiming().easing, background: getComputedStyle(card).backgroundColor, title: card.querySelector('.notice-title').textContent, titleColor: getComputedStyle(card.querySelector('.notice-title')).color, children: card.querySelector('.notice-title').getAnimations().length + card.querySelector('.notice-text').getAnimations().length };
    });
    assert.equal(motion.easing, 'linear'); assert.ok(motion.positions[0] > motion.positions[1] && motion.positions[1] > motion.positions[2]);
    assert.ok(Math.abs((motion.positions[0] - motion.positions[1]) - (motion.positions[1] - motion.positions[2])) < 1);
    assert.ok(motion.positions[0] >= motion.parent.right); assert.ok(motion.positions[4] + motion.width <= motion.parent.left);
    assert.equal(motion.background, 'rgba(22, 60, 50, 0)'); assert.equal(motion.title, 'KoraScore Ai'); assert.equal(motion.titleColor, 'rgb(68, 204, 119)'); assert.equal(motion.children, 2);
    await viewer.screenshot({ path: join(output, 'operator-embed-notice.png') });
    await frame.click('.notice-media'); await frame.waitForSelector('.notice-image-viewer:not([hidden])');
    await viewer.screenshot({ path: join(output, 'operator-image-mobile.png') });
    await frame.click('.notice-image-viewer .notice-close');
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await viewer.setViewport({ width: 1366, height: 900 });
    await checkImageFrame();
    await frame.waitForFunction(() => { const card = document.querySelector('.broadcast-notice').getBoundingClientRect(); return card.left >= 0 && card.right <= innerWidth; });
    await viewer.screenshot({ path: join(output, 'operator-notice-desktop.png') });
    await viewer.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await frame.waitForFunction(() => document.querySelector('.broadcast-notice').getAnimations().length === 0);
    await page.bringToFront(); await page.click('#stop-notices');
    await viewer.bringToFront(); await frame.waitForSelector('.broadcast-notice[hidden]', { timeout: 10000 });
    console.log('notice stopped');
    await page.bringToFront(); await page.screenshot({ path: join(output, 'operator-notices-mobile.png'), fullPage: true });
    await page.bringToFront(); await page.click('[data-view="matches-view"]'); await page.click('#save-selection');
    await viewer.bringToFront(); await frame.waitForFunction(() => window.channelRefreshes === 1, { timeout: 10000 });
    assert.deepEqual(errors, []);
    if (process.env.QA_PLAYWRIGHT_PATH) {
      const { chromium } = require(process.env.QA_PLAYWRIGHT_PATH);
      const connected = await chromium.connectOverCDP(browser.wsEndpoint());
      const visual = await connected.contexts()[0].newPage();
      await visual.goto(config.api + config.operatorConsolePath);
      await visual.locator('#workspace:not([hidden])').waitFor();
      for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
        await visual.setViewportSize(viewport); await visual.bringToFront();
        await visual.waitForFunction(() => Number(document.getElementById('operator-depth').dataset.frames) >= 2);
        const initial = await visual.evaluate(() => Number(document.getElementById('operator-depth').dataset.frames));
        await visual.mouse.move(30, 30);
        await visual.waitForFunction(initial => Number(document.getElementById('operator-depth').dataset.frames) > initial + 3, initial);
        assert.equal(await visual.evaluate(() => { const canvas = document.getElementById('operator-depth'), gl = canvas.getContext('webgl2'); const bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes.some((value, index) => index % 4 === 3 && value > 0) && document.documentElement.scrollWidth <= innerWidth; }), true);
        await visual.screenshot({ path: join(output, `operator-depth-playwright-${viewport.width}.png`), fullPage: true });
      }
      await visual.close(); console.log('Playwright desktop/mobile canvas and screenshots checked');
    }
    console.log(JSON.stringify({ login: true, desktopOverflow: false, mobileOverflow: false, depthCanvasPixelsAndMotion: true, wholeCardSizing: true, imageFrameFitsAspect: true, embedNotice: true, continuousLinearMotion: true, transparentBackground: true, independentTextAnimations: true, immediateStop: true, realtimeChannelRefresh: true, screenshots: output }));
  } catch (error) { console.error(error.stack); throw error; } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (resolve(dir).startsWith(resolve(tmpdir()) + require('node:path').sep + 'koratv-operator-qa-')) await rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
