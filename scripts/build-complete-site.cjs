const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { buildPublicSite } = require('./build-public-site.cjs');
const { generate } = require('./generate-match-pages.cjs');
const { generateNews, normalize, articlePath } = require('./news-pages.cjs');

function assertCompletePublication(root, output) {
  const host = fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim();
  const siteUrl = new URL(host.includes('://') ? host : 'https://' + host).origin;
  const required = ['index.html', 'news.html', 'sitemap.xml', 'sitemap-articles.xml',
    'robots.txt', 'news/catalog.json', 'news/feed.json', 'news/archive/index.html'];
  for (const file of required) {
    if (!fs.existsSync(path.join(output, file))) throw new Error('Incomplete publication: missing ' + file);
  }
  const catalogPath = path.join(output, 'news/catalog.json');
  if (fs.statSync(catalogPath).size > 16000000) throw new Error('News catalog exceeds publication limit');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (catalog.version !== 1 || catalog.siteUrl !== siteUrl || !Array.isArray(catalog.articles) || !catalog.articles.length)
    throw new Error('Incomplete publication: invalid news catalog');
  const articles = catalog.articles.map(raw => normalize(raw));
  if (articles.some((article, index) => !article || article.slug !== catalog.articles[index].slug))
    throw new Error('Incomplete publication: invalid article');
  for (const article of articles) {
    if (!fs.existsSync(path.join(output, 'news', article.slug, 'index.html')))
      throw new Error('Incomplete publication: missing article ' + article.id);
  }
  const readMap = filename => {
    const $ = load(fs.readFileSync(path.join(output, filename), 'utf8'), { xmlMode: true });
    if ($.root().children().length !== 1 || !$('urlset').length
      || $('urlset').attr('xmlns') !== 'http://www.sitemaps.org/schemas/sitemap/0.9')
      throw new Error('Invalid sitemap: ' + filename);
    const urls = $('urlset > url > loc').toArray().map(node => $(node).text());
    if (!urls.length || new Set(urls).size !== urls.length
      || urls.some(url => new URL(url).origin !== siteUrl)) throw new Error('Invalid sitemap URLs: ' + filename);
    return new Set(urls);
  };
  const primary = readMap('sitemap.xml');
  const news = readMap('sitemap-articles.xml');
  for (const article of articles.filter(article => article.indexable)) {
    const url = siteUrl + articlePath(article);
    if (!primary.has(url) || !news.has(url)) throw new Error('Reviewed article missing from sitemap: ' + article.id);
  }
  for (const url of news) if (!primary.has(url)) throw new Error('News sitemap is not represented in primary sitemap');
  const feed = JSON.parse(fs.readFileSync(path.join(output, 'news/feed.json'), 'utf8'));
  const routes = new Set(articles.map(articlePath));
  if (feed.version !== 1 || !Array.isArray(feed.articles) || !feed.articles.length
    || feed.articles.some(article => !routes.has(article.path))) throw new Error('Invalid public news feed');
  const robots = fs.readFileSync(path.join(output, 'robots.txt'), 'utf8');
  if (!robots.includes('Sitemap: ' + siteUrl + '/sitemap-articles.xml'))
    throw new Error('Article sitemap missing from robots.txt');
  return { articles: articles.length, sitemapUrls: primary.size, newsSitemapUrls: news.size };
}

async function buildCompleteSite({ root = path.resolve(__dirname, '..'),
  build = buildPublicSite, matches = generate, news = generateNews } = {}) {
  const output = await build({ root });
  await matches(output);
  await news({ root, output });
  const verified = assertCompletePublication(root, output);
  console.log('Complete publication verified: ' + JSON.stringify(verified));
  return { output, ...verified };
}

module.exports = { buildCompleteSite, assertCompletePublication };
if (require.main === module) buildCompleteSite().catch(error => {
  console.error('[publication] ' + error.message);
  process.exitCode = 1;
});
