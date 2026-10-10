const puppeteer = require('puppeteer');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { load } = require('cheerio');

(async () => {
  const live = process.argv.includes('--live');
  const browser = await puppeteer.launch({ headless: true });
  const shots = path.resolve('streaming-gateway/dist/qa-archive');
  await fs.mkdir(shots, { recursive: true });
  try {
    for (const [host, root] of [['koratv.click', 'D:/Projects/koratv-web/_site'], ['fraja.online', 'D:/Projects/foottv6/_site']]) {
      const sitemap = load(await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8'), { xmlMode: true });
      const urls = sitemap('loc').toArray().map(el => sitemap(el).text());
      for (const url of urls) {
        const pathname = decodeURIComponent(new URL(url).pathname);
        await fs.access(path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname));
      }
      const competition = urls.find(url => /\/competitions\/[^/]+\/$/.test(url));
      const teams = load(await fs.readFile(path.join(root, 'teams/index.html'), 'utf8'));
      const team = `https://${host}${teams('.directory-list a').first().attr('href')}`;
      assert.ok(competition && team);
      const routes = [`https://${host}/archive/`, competition, team];
      for (const width of [390, 1366]) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 900 });
        await page.setJavaScriptEnabled(false);
        if (!live) {
          await page.setRequestInterception(true);
          page.on('request', async request => {
            try {
              const url = new URL(request.url());
              if (url.hostname !== host) return await request.continue();
              const pathname = decodeURIComponent(url.pathname);
              const filename = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
              const body = await fs.readFile(filename);
              const contentType = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
              await request.respond({ status: 200, contentType, body });
            } catch { await request.abort().catch(() => {}); }
          });
        }
        for (const route of routes) {
          const response = await page.goto(route, { waitUntil: 'networkidle2', timeout: 60000 });
          assert.equal(response.status(), 200);
          const result = await page.evaluate(() => ({
            title: document.querySelector('h1')?.textContent,
            links: document.querySelectorAll('.result-list a').length,
            overflow: document.documentElement.scrollWidth > innerWidth,
            headingsFit: [...document.querySelectorAll('h1,strong')].every(el => el.scrollWidth <= el.clientWidth + 1),
            content: document.body.innerText
          }));
          assert.ok(result.title && result.links > 0);
          assert.equal(result.overflow, false);
          assert.ok(!/SECRET_PROVIDER|PRIVATE KEY|streamUrl/.test(result.content));
          const label = new URL(route).pathname.split('/')[1];
          await page.screenshot({ path: path.join(shots, `${host}-${live ? 'live' : 'local'}-${label}-${width}.png`) });
          console.log(JSON.stringify({ host, width, route: label, live, links: result.links, overflow: result.overflow }));
        }
        await page.close();
      }
      console.log(JSON.stringify({ host, sitemapRoutesChecked: urls.length }));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
