const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load } = require('cheerio');
const puppeteer = require('puppeteer');

async function main() {
  const live = process.argv.includes('--live');
  const origin = 'https://koratv.click';
  const root = path.resolve(__dirname, '../_site');
  const read = async pathname => {
    if (!live) return fs.readFile(path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)), 'utf8');
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('x-robots-tag'), null);
    return response.text();
  };
  const homepage = await read('/');
  const $ = load(homepage);
  assert.ok($('title').text().startsWith('koratv |'));
  assert.equal($('link[rel=canonical]').attr('href'), origin + '/');
  assert.equal($('meta[property="og:site_name"]').attr('content'), 'koratv');
  const schema = JSON.parse($('script[type="application/ld+json"]').first().text());
  assert.equal(schema['@graph'].find(node => node['@type'] === 'WebSite').name, 'koratv');
  const links = [...new Set($('a[href^="/match/"]').map((_, node) => $(node).attr('href')).get())];
  assert.ok(links.length > 0, 'Homepage must expose match links in the initial HTML');
  assert.ok(!/noindex/.test($('meta[name=robots]').attr('content')));
  const sitemap = load(await read('/sitemap.xml'), { xmlMode: true });
  const urls = sitemap('loc').map((_, node) => sitemap(node).text()).get();
  assert.equal(new Set(urls).size, urls.length);
  for (const link of links) {
    assert.ok(urls.some(url => decodeURIComponent(url) === decodeURIComponent(origin + link)), link + ' missing from sitemap');
    const html = load(await read(link + 'index.html'));
    assert.equal(decodeURIComponent(html('link[rel=canonical]').attr('href')), decodeURIComponent(origin + link));
    assert.ok(html('main h1').text().trim());
  }
  assert.match(await read('/robots.txt'), /Sitemap: https:\/\/koratv.click\/sitemap.xml/);
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const width of [390, 1366]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', async request => {
        try {
          const url = new URL(request.url());
          if (url.origin !== origin) return request.abort();
          if (live) return request.continue();
          const filename = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
          if (!filename.startsWith(root + path.sep)) return request.abort();
          const body = await fs.readFile(filename);
          const contentType = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream';
          return request.respond({ status: 200, contentType, body });
        } catch { await request.abort().catch(() => {}); }
      });
      await page.goto(origin, { waitUntil: 'networkidle0' });
      assert.ok(await page.$('#featured-matches .prerendered-match'));
      assert.equal(await page.$eval('html', element => element.scrollWidth > innerWidth), false);
      const heading = await page.$eval('h1', element => ({ width: element.clientWidth, text: element.scrollWidth }));
      assert.ok(heading.text <= heading.width, 'Homepage brand heading is clipped');
      if (process.env.QA_OUTPUT_DIR) await page.screenshot({ path: path.join(process.env.QA_OUTPUT_DIR, 'koratv-seo-nojs-' + width + '.png') });
      console.log(JSON.stringify({ live, width, initialHtmlMatchLinks: links.length, javaScriptRequiredForSchedule: false, overflow: false }));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ live, name: 'koratv', sitemapUrls: urls.length, linkedPagesChecked: links.length }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
