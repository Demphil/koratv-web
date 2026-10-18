const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('cheerio');
const { SOURCES, safeUrl, normalize, parseFeed, mergeArticles, loadPrevious,
  collectFeeds, articlePath, renderArticle, writeNews, generateNews } = require('./news-pages.cjs');
const now = '2026-10-18T16:00:00.000Z';
const config = { siteUrl: 'https://example.test', brand: 'Example', logo: '/logo.webp' };
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/news/editorial.json'), 'utf8'));
const raw = (extra = {}) => ({ title: 'A football result', description: 'A short description of the result.',
  sourceUrl: 'https://www.hespress.com/story-123.html', sourcePublishedAt: '2026-10-18T12:00:00Z',
  image: 'https://images.example.test/photo.jpg', ...extra });
const brief = (extra = {}) => normalize(raw(extra), now);

test('URLs reject unsafe protocols and credentials and strip only tracking parameters', () => {
  for (const value of ['javascript:alert(1)', 'http://example.test/', 'https://user:pass@example.test/',
    'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://example.test:8443/x']) {
    assert.equal(safeUrl(value), '');
  }
  assert.equal(safeUrl('https://example.test/a?utm_source=x&id=2#fragment'), 'https://example.test/a?id=2');
  assert.equal(brief({ sourceUrl: 'https://untrusted.test/story' }), null);
  assert.equal(brief({ sourcePublishedAt: 'not-a-date' }), null);
  assert.equal(brief({ sourcePublishedAt: '2026-10-19T00:00:00Z' }), null);
});

test('RSS content is sanitized, image extracted, and raw quotes remain short', () => {
  const long = Array.from({ length: 80 }, (_, index) => 'word' + index).join(' ');
  const xml = '<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title><![CDATA[<b>Title</b><script>evil()</script>]]></title>'
    + '<link>https://www.hespress.com/story.html</link><pubDate>Sun, 18 Oct 2026 12:00:00 GMT</pubDate>'
    + '<description><![CDATA[<img src="https://images.example.test/photo.jpg">' + long + ']]></description>'
    + '</item><item><title>Foreign</title><link>https://evil.test/story</link><pubDate>Sun, 18 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
  const entries = parseFeed(xml, SOURCES[1], now);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Title');
  assert.equal(entries[0].image, 'https://images.example.test/photo.jpg');
  assert.ok((entries[0].title + ' ' + entries[0].summary).trim().split(/\s+/).length <= 25);
  assert.equal(entries[0].indexable, false);
  assert.deepEqual(entries[0].sections, []);
  assert.throws(() => parseFeed('<html>not a feed</html>', SOURCES[1], now), /Invalid RSS/);
});

test('all manually reviewed digests have dated sources and original substantial sections', () => {
  assert.equal(seed.length, 3);
  for (const item of seed) {
    const article = normalize(item, now);
    assert.equal(article.indexable, true);
    assert.ok(article.sections.length >= 2);
    assert.ok(article.sections.map(section => section.text).join(' ').length >= 350);
    assert.ok(article.image.startsWith('https://'));
    assert.ok(article.reviewedAt);
  }
  assert.equal(brief({ reviewedAt: now, sections: [{ text: 'Short' }] }).indexable, false);
});

test('slug and publication date are permanent and timestamps do not churn on unchanged builds', () => {
  const original = brief();
  const later = '2026-10-18T18:00:00.000Z';
  const unchanged = normalize(raw(), later);
  const merged = mergeArticles([original], [unchanged], [], later)[0];
  assert.equal(merged.slug, original.slug);
  assert.equal(merged.publishedAt, original.publishedAt);
  assert.equal(merged.modifiedAt, original.modifiedAt);
  const changed = mergeArticles([original], [normalize(raw({ title: 'Updated result' }), later)], [], later)[0];
  assert.equal(changed.slug, original.slug);
  assert.equal(changed.modifiedAt, later);
});

test('reviewed articles are never replaced with RSS snippets and prior pages survive missing feeds', () => {
  const first = mergeArticles([], [], seed, now);
  const later = '2026-10-18T18:00:00.000Z';
  const incoming = normalize({ ...seed[0], reviewedAt: null, sections: [] }, later);
  const next = mergeArticles(first, [incoming], seed, later);
  assert.equal(next.length, 3);
  assert.equal(next.find(item => item.id === first[0].id).modifiedAt, first[0].modifiedAt);
  assert.ok(next.every(item => item.indexable));
  assert.deepEqual(mergeArticles(first, [], [], later), first);
});

test('article HTML has self canonical, source attribution, visible dates, escaped text and no player', () => {
  const article = normalize({ ...seed[0], title: '<b>Result</b> & "facts"' }, now);
  const $ = load(renderArticle(article, config, []));
  const canonical = config.siteUrl + articlePath(article);
  assert.equal($('link[rel=canonical]').attr('href'), canonical);
  assert.equal($('meta[name=robots]').attr('content'), 'index,follow,max-image-preview:large');
  assert.equal($('h1').text(), 'Result & "facts"');
  assert.ok($('time[datetime="' + article.publishedAt + '"]').length);
  assert.ok($('a[href="' + article.sourceUrl + '"]').length);
  assert.equal($('iframe,video').length, 0);
  assert.ok($('figure img').attr('src').startsWith('https://'));
  const schema = JSON.parse($('script[type="application/ld+json"]').text());
  assert.equal(schema['@graph'][0]['@type'], 'NewsArticle');
  assert.equal(schema['@graph'][0].datePublished, article.publishedAt);
  assert.equal(schema['@graph'][0].citation, article.sourceUrl);
});

test('automatic snippets are honest noindex source briefs, not fake full NewsArticles', () => {
  const $ = load(renderArticle(brief(), config, []));
  assert.match($('meta[name=robots]').attr('content'), /^noindex,follow/);
  assert.equal(JSON.parse($('script[type="application/ld+json"]').text())['@graph'][0]['@type'], 'WebPage');
});

test('archive bootstrap permits 404 but fails closed on outages, wrong origin and malformed catalogs', async () => {
  assert.deepEqual(await loadPrevious(config, now, async () => new Response('', { status: 404 })), { articles: [], feeds: [] });
  await assert.rejects(loadPrevious(config, now, async () => new Response('', { status: 503 })), /unavailable/);
  for (const value of [{}, { version: 1, siteUrl: 'https://other.test', articles: [], feeds: [] },
    { version: 1, siteUrl: config.siteUrl, articles: [{}], feeds: [] }]) {
    await assert.rejects(loadPrevious(config, now, async () => new Response(JSON.stringify(value))));
  }
  const prior = { version: 1, siteUrl: config.siteUrl, articles: [brief()], feeds: [] };
  assert.equal((await loadPrevious(config, now, async () => new Response(JSON.stringify(prior)))).articles.length, 1);
});

test('feeds use conditional requests, retain old data on failure, and only call fixed publishers', async () => {
  const previous = { articles: [brief()], feeds: SOURCES.map(source => ({ url: source.url, etag: '"version1"' })) };
  const calls = [];
  const output = await collectFeeds(previous, now, async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 304 });
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.url), SOURCES.map(source => source.url));
  assert.ok(calls.every(call => call.options.headers['If-None-Match'] === '"version1"'));
  assert.equal(output.feeds.length, 3);
  assert.deepEqual(output.articles, []);
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-news-'));
  fs.writeFileSync(path.join(root, 'CNAME'), 'example.test');
  const homepage = '<html><head><link rel="canonical" href="https://example.test/"><script src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script></head><body><div id="news-grid-container">Old</div><script src="https://ads.example.test/tag.js"></script></body></html>';
  fs.writeFileSync(path.join(root, 'index.html'), homepage);
  const output = path.join(root, '_site');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'index.html'), homepage);
  fs.writeFileSync(path.join(output, 'news.html'), '<html><head></head><body><main><div id="breaking-news"></div><div id="sports-news"></div></main><script src="https://ads.example.test/tag.js"></script></body></html>');
  fs.writeFileSync(path.join(output, 'sitemap.xml'), '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/match/kept/</loc><lastmod>2026-10-17</lastmod></url></urlset>');
  fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return { root, output };
}

test('static output has internal cards and archive; only reviewed news enters sitemaps; match URLs and ads survive', () => {
  const { root, output } = fixture();
  try {
    const articles = mergeArticles([], [brief()], seed, now);
    writeNews(output, config, articles, []);
    const homepage = load(fs.readFileSync(path.join(output, 'index.html'), 'utf8'));
    assert.equal(homepage('#news-grid-container article').length, 4);
    assert.ok(homepage('#news-grid-container a').toArray().every(node => homepage(node).attr('href').startsWith('/news/')));
    assert.equal(homepage('script[src="https://ads.example.test/tag.js"]').length, 1);
    assert.equal(homepage('link[data-news-cards]').length, 1);
    const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /https:\/\/example.test\/match\/kept\//);
    for (const article of articles) assert.equal(sitemap.includes(config.siteUrl + articlePath(article)), article.indexable);
    assert.ok(fs.existsSync(path.join(output, 'news/archive/index.html')));
    assert.ok(fs.existsSync(path.join(output, 'sitemap-articles.xml')));
    assert.match(fs.readFileSync(path.join(output, 'robots.txt'), 'utf8'), /sitemap-articles.xml/);
    const feed = JSON.parse(fs.readFileSync(path.join(output, 'news/feed.json'), 'utf8'));
    assert.ok(feed.articles.every(article => article.path.startsWith('/news/')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generation needs no streaming credentials and applies the existing analytics to internal pages', async () => {
  const { root, output } = fixture();
  try {
    const result = await generateNews({ root, output, now, previous: { articles: [], feeds: [] }, fresh: [], curated: seed,
      fetcher: () => { throw new Error('No network in this test'); } });
    for (const article of result.articles) {
      const html = fs.readFileSync(path.join(output, 'news', article.slug, 'index.html'), 'utf8');
      assert.match(html, /data-site-metrics/);
      assert.doesNotMatch(html, /stream-api|fabor\.sbs|pool-heartbeat|sb_secret/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function client(fetcher) {
  const grid = { innerHTML: 'SERVER_RENDERED_NEWS' };
  const elements = { 'sports-news': grid };
  const handlers = {};
  const code = fs.readFileSync(path.join(__dirname, '../assets/js/news.js'), 'utf8')
    .replace(/^import .*$/m, '');
  const context = vm.createContext({ URL, AbortSignal, Date, console, setTimeout, fetch: fetcher,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { location: { origin: 'https://example.test' } },
    document: { getElementById: key => elements[key] || null, querySelectorAll: () => [],
      addEventListener: (event, handler) => { handlers[event] = handler; } } });
  vm.runInContext(code + ';globalThis.testNews = { fetchNews, sanitizeUrl, categoryTerms, setupFilterClick };', context);
  return { context, grid, handlers, api: context.testNews };
}

test('client snapshot outages leave server-rendered articles intact', async () => {
  const app = client(async () => { throw new Error('offline'); });
  await app.handlers.DOMContentLoaded();
  assert.equal(app.grid.innerHTML, 'SERVER_RENDERED_NEWS');
});

test('client accepts local article URLs only and no longer calls a third-party RSS proxy', async () => {
  const calls = [];
  const app = client(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ version: 1, articles: [
      { path: '/news/good/' }, { path: 'https://evil.test/news/bad/' }, { path: '/match/not-news/' }
    ] }));
  });
  assert.equal((await app.api.fetchNews()).length, 1);
  assert.deepEqual(calls.map(call => call.url), ['/news/feed.json']);
  assert.equal(app.api.sanitizeUrl('https://evil.test/news/a/'), '#');
  assert.equal(app.api.sanitizeUrl('/news/good/'), 'https://example.test/news/good/');
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/news.js'), 'utf8');
  assert.doesNotMatch(source, /rss2json|allorigins|api\.rss/);
});

test('visible category buttons map to working filters rather than literal slug searches', () => {
  const app = client(async () => new Response('{}'));
  let click;
  const button = { dataset: { category: 'كرة-القدم-الإسبانية' },
    parentElement: { querySelectorAll: () => [] }, classList: { add: () => {} },
    addEventListener: (_, handler) => { click = handler; } };
  app.api.setupFilterClick(button);
  vm.runInContext("globalThis.selected = null; applyFilter = value => { globalThis.selected = value; };", app.context);
  click();
  assert.equal(app.context.selected, 'spanish');
  assert.ok(app.api.categoryTerms.spanish.includes('ريال مدريد'));
});

test('new article pages reuse the unchanged site news palette and background', () => {
  const html = renderArticle(normalize(seed[0], now), config, []);
  const $ = load(html);
  assert.equal($('link[href="/assets/css/news.css"]').length, 1);
  const css = fs.readFileSync(path.join(__dirname, '../assets/css/article.css'), 'utf8');
  assert.match(css, /--accent:var\(--secondary-color\)/);
  assert.match(css, /--ink:var\(--light-color\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  const body = css.match(/body\.article-page\{([^}]+)\}/)[1];
  assert.doesNotMatch(body, /background:/);
});

