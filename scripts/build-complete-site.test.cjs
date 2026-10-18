const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCompleteSite, assertCompletePublication } = require('./build-complete-site.cjs');
const { normalize, writeNews, loadPrevious } = require('./news-pages.cjs');
const config = { siteUrl: 'https://example.test', brand: 'Example', logo: '/logo.webp' };
const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/news/editorial.json'), 'utf8'));

function fixture(complete = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-pages-'));
  const output = path.join(root, '_site');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(root, 'CNAME'), 'example.test');
  fs.writeFileSync(path.join(output, 'index.html'), '<html><head></head><body><div id="news-grid-container"></div></body></html>');
  fs.writeFileSync(path.join(output, 'news.html'), '<html><head></head><body><main><div id="breaking-news"></div><div id="sports-news"></div></main></body></html>');
  fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  fs.writeFileSync(path.join(output, 'sitemap.xml'), '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/</loc></url><url><loc>https://example.test/match/kept/</loc></url></urlset>');
  const articles = reviewed.map(article => normalize(article));
  if (complete) writeNews(output, config, articles, []);
  return { root, output, articles, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('every Pages workflow uses the same complete build, including scheduled metadata publication', () => {
  const workflowDir = path.join(__dirname, '../.github/workflows');
  const publishers = fs.readdirSync(workflowDir).filter(file => /\.ya?ml$/.test(file)).filter(file => {
    return /actions\/(?:upload-pages-artifact|deploy-pages)@/.test(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
  });
  assert.deepEqual(publishers.sort(), ['publish-site.yml', 'sync-data.yml']);
  const scheduled = publishers.filter(file => /^  schedule:/m.test(fs.readFileSync(path.join(workflowDir, file), 'utf8')));
  assert.deepEqual(scheduled, ['sync-data.yml']);
  for (const file of publishers) {
    const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
    assert.match(text, /node scripts\/build-complete-site\.cjs/, file);
    assert.match(text, /node --test[^\n]*scripts\/build-complete-site\.test\.cjs/, file);
    assert.doesNotMatch(text, /node scripts\/(?:build-public-site|generate-match-pages|news-pages)\.cjs/, file);
    assert.match(text, /group: static-pages-production/, file);
  }
});

test('assets, matches and news are built in order before the complete artifact passes validation', async () => {
  const f = fixture(false);
  const calls = [];
  try {
    const result = await buildCompleteSite({ root: f.root,
      build: async () => { calls.push('assets'); return f.output; },
      matches: async output => { assert.equal(output, f.output); calls.push('matches'); },
      news: async ({ output }) => { calls.push('news'); writeNews(output, config, f.articles, []); } });
    assert.deepEqual(calls, ['assets', 'matches', 'news']);
    assert.equal(result.articles, 3);
    assert.equal(result.newsSitemapUrls, 4);
    assert.match(fs.readFileSync(path.join(f.output, 'sitemap.xml'), 'utf8'), /\/match\/kept\//);
  } finally { f.cleanup(); }
});

test('an incomplete legacy-style build cannot be published even if static assets and matches succeeded', async () => {
  const f = fixture(false);
  try {
    await assert.rejects(buildCompleteSite({ root: f.root, build: async () => f.output,
      matches: async () => {}, news: async () => {} }), /missing sitemap-articles.xml/);
  } finally { f.cleanup(); }
});

test('a failed news build aborts publication rather than uploading a partial site', async () => {
  const f = fixture(false);
  try {
    await assert.rejects(buildCompleteSite({ root: f.root, build: async () => f.output,
      matches: async () => {}, news: async () => { throw new Error('archive unavailable'); } }), /archive unavailable/);
  } finally { f.cleanup(); }
});

test('publication guard rejects missing story pages and mismatched local feed links', () => {
  const f = fixture();
  try {
    const story = path.join(f.output, 'news', f.articles[0].slug, 'index.html');
    const html = fs.readFileSync(story);
    fs.unlinkSync(story);
    assert.throws(() => assertCompletePublication(f.root, f.output), /missing article/);
    fs.writeFileSync(story, html);
    fs.writeFileSync(path.join(f.output, 'news/feed.json'), JSON.stringify({ version: 1, articles: [{ path: '/news/missing/' }] }));
    assert.throws(() => assertCompletePublication(f.root, f.output), /Invalid public news feed/);
  } finally { f.cleanup(); }
});

test('publication guard rejects a sitemap that drops reviewed stories or contains external URLs', () => {
  const f = fixture();
  try {
    const filename = path.join(f.output, 'sitemap.xml');
    const original = fs.readFileSync(filename, 'utf8');
    fs.writeFileSync(filename, original.replace(/<url><loc>https:\/\/example.test\/news\/[\s\S]*?<\/url>/, ''));
    assert.throws(() => assertCompletePublication(f.root, f.output), /Reviewed article missing/);
    fs.writeFileSync(filename, original.replace('https://example.test/', 'https://external.test/'));
    assert.throws(() => assertCompletePublication(f.root, f.output), /Invalid sitemap URLs/);
  } finally { f.cleanup(); }
});

test('recovery checkpoint preserves all previously published URLs and original timestamps after a catalog 404', async () => {
  const recovery = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/news/archive-seed.json'), 'utf8'));
  const result = await loadPrevious({ siteUrl: recovery.siteUrl }, '2026-10-18T21:00:00Z',
    async () => new Response('', { status: 404 }), recovery);
  assert.equal(result.articles.length, 77);
  for (const original of recovery.articles) {
    const restored = result.articles.find(article => article.id === original.id);
    assert.equal(restored.slug, original.slug);
    assert.equal(restored.publishedAt, original.publishedAt);
    assert.equal(restored.modifiedAt, original.modifiedAt);
  }
});

test('recovery is scoped to the correct site and never masks a live archive outage', async () => {
  const recovery = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/news/archive-seed.json'), 'utf8'));
  await assert.rejects(loadPrevious(config, '2026-10-18T21:00:00Z',
    async () => new Response('', { status: 404 }), recovery), /Invalid previous news archive/);
  await assert.rejects(loadPrevious({ siteUrl: recovery.siteUrl }, '2026-10-18T21:00:00Z',
    async () => new Response('', { status: 503 }), recovery), /unavailable/);
  const live = { version: 1, siteUrl: recovery.siteUrl, articles: [recovery.articles[0]], feeds: [] };
  const result = await loadPrevious({ siteUrl: recovery.siteUrl }, '2026-10-18T21:00:00Z',
    async () => new Response(JSON.stringify(live)), recovery);
  assert.equal(result.articles.length, 1);
});
