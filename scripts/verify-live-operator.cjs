const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

(async () => {
  const file = await readFile(process.argv[2], 'utf8');
  const url = file.match(/^URL: (.+)$/m)?.[1];
  const username = file.match(/^Username: (.+)$/m)?.[1];
  const password = file.match(/^Password: (.+)$/m)?.[1];
  const origin = new URL(url).origin;
  assert.equal((await fetch(`${origin}/api/operator/state`)).status, 401);
  const login = await fetch(`${origin}/api/operator/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(login.status, 200, 'Live login failed');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await login.json();
  const stateResponse = await fetch(`${origin}/api/operator/state`, { headers: { Cookie: cookie } });
  assert.equal(stateResponse.status, 200); const state = await stateResponse.json();
  assert.equal(JSON.stringify(state).includes(password), false);
  assert.equal(state.status.accounts.some(account => 'username' in account || 'server' in account), false);
  assert.equal(state.matches.some(match => 'lineups' in match || 'streams' in match), false);
  const denied = await fetch(`${origin}/api/operator/notices/stop`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
  const controller = new AbortController();
  const events = await fetch(`${origin}/api/broadcast-events`, { headers: { Origin: 'https://fabor.sbs' }, signal: controller.signal });
  assert.equal(events.status, 200); assert.equal(events.headers.get('access-control-allow-origin'), 'https://fabor.sbs');
  const reader = events.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /event: control/); controller.abort();
  const player = await (await fetch('https://fabor.sbs/739184.html')).text();
  assert.match(player, /broadcast-control\.js\?v=/);
  assert.match(player, /broadcast-notice\.css\?v=/);
  assert.doesNotMatch(player, /\/api\/operator\//);
  for (const asset of ['broadcast-control.js', 'broadcast-notice.css', 'player.js', 'config.js']) {
    const path = player.match(new RegExp('(?:src|href)="(\\./' + asset.replace('.', '\\.') + '\\?v=[^"]+)"'))?.[1];
    assert.ok(path, `Missing public player asset ${asset}`);
    const response = await fetch(new URL(path, 'https://fabor.sbs/739184.html')); assert.equal(response.status, 200);
    const content = await response.text(); assert.doesNotMatch(content, /\/api\/operator\//);
    if (asset.endsWith('.css')) assert.match(content, /broadcast-notice-pass/);
  }
  for (const frontend of ['https://koratv.click', 'https://fraja.online']) {
    const html = await (await fetch(frontend)).text(); assert.match(html, /20261004-operator-live/);
  }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage(); await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setViewport({ width: 390, height: 844 }); await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.type('#password', password); await page.click('#login button'); await page.waitForSelector('#workspace:not([hidden])', { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.click('[data-view="notices-view"]'); await page.waitForSelector('#notice-preview-stage');
    assert.equal(await page.$eval('.broadcast-notice', node => getComputedStyle(node).backdropFilter), 'blur(12px) saturate(1.2)');
    console.log(JSON.stringify({ liveLogin: true, protectedApi: true, csrfRejected: true, secretsRedacted: true, bothFrontendMarkers: true, playerMarker: true, embedEventStream: true, mobileOverflow: false, noticeStyleDeployed: true, consoleRouteAbsentFromPlayer: true, matches: state.matches.length }));
  } finally {
    await browser?.close();
    await fetch(`${origin}/api/operator/logout`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-Operator-CSRF': csrf, 'Content-Type': 'application/json' }, body: '{}' });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
