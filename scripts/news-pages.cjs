const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { load } = require('cheerio');
const { measurementIdFromHomepage, instrumentPublicPages } = require('./public-analytics.cjs');

const SOURCES = [
  { name: 'RT عربي', url: 'https://rtarabic.com/rss/sport/', hosts: ['rtarabic.com', 'arabic.rt.com'] },
  { name: 'هسبريس', url: 'https://www.hespress.com/sport/feed', hosts: ['www.hespress.com', 'hespress.com'] },
  { name: 'فرانس 24', url: 'https://www.france24.com/ar/%D8%B1%D9%8A%D8%A7%D8%B6%D8%A9/rss', hosts: ['www.france24.com', 'france24.com'] }
];
const SOURCE_HOSTS = new Set(SOURCES.flatMap(source => source.hosts));
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const plain = value => { const $ = load(String(value || '')); $('script,style,iframe').remove(); return $.text().replace(/\s+/g, ' ').trim(); };
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const limitWords = (value, limit) => words(value).slice(0, Math.max(0, limit)).join(' ');
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);

function safeUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    if (url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    return url.href.replace(/%[0-9a-f]{2}/gi, value => value.toUpperCase());
  } catch { return ''; }
}

function sourceUrl(value) {
  const url = safeUrl(value);
  return url && SOURCE_HOSTS.has(new URL(url).hostname) ? url : '';
}

function slugFor(title, id) {
  const readable = String(title).normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 90);
  return (readable || 'news') + '-' + id;
}

function normalize(raw, now = new Date().toISOString()) {
  const link = sourceUrl(raw.sourceUrl || raw.link);
  const sourcePublishedAt = iso(raw.sourcePublishedAt || raw.pubDate);
  const title = plain(raw.title).slice(0, 250);
  if (!link || !sourcePublishedAt || !title || Date.parse(sourcePublishedAt) > Date.parse(now) + 300000) return null;
  const id = digest(link);
  const slug = typeof raw.slug === 'string' && /^[\p{L}\p{N}-]{1,160}$/u.test(raw.slug) && raw.slug.endsWith('-' + id)
    ? raw.slug : slugFor(title, id);
  const sections = Array.isArray(raw.sections) ? raw.sections.slice(0, 12).map(section => ({
    heading: plain(section.heading).slice(0, 160), text: plain(section.text).slice(0, 5000)
  })).filter(section => section.text) : [];
  const facts = Array.isArray(raw.facts) ? raw.facts.slice(0, 12).map(fact => ({
    label: plain(fact.label).slice(0, 80), value: plain(fact.value).slice(0, 250)
  })).filter(fact => fact.label && fact.value) : [];
  const reviewedAt = iso(raw.reviewedAt);
  const editorial = Boolean(reviewedAt && sections.length >= 2
    && sections.map(section => section.text).join(' ').length >= 350
    && Date.parse(reviewedAt) <= Date.parse(now) + 300000);
  const summary = editorial ? plain(raw.summary).slice(0, 500) : limitWords(plain(raw.summary || raw.description), 25 - words(title).length);
  return {
    id, slug, title: editorial ? title : limitWords(title, 25), summary, sourceUrl: link,
    sourceName: SOURCES.find(source => source.hosts.includes(new URL(link).hostname)).name,
    sourcePublishedAt, image: safeUrl(raw.image || raw.thumbnail, link),
    tags: Array.isArray(raw.tags) ? raw.tags.map(plain).filter(Boolean).slice(0, 8) : [],
    sections: editorial ? sections : [], facts: editorial ? facts : [], reviewedAt: editorial ? reviewedAt : null,
    indexable: editorial, publishedAt: iso(raw.publishedAt) || now, modifiedAt: iso(raw.modifiedAt) || now
  };
}

function parseFeed(xml, source, now) {
  const $ = load(xml, { xmlMode: true });
  if (!$('rss,feed').length) throw new Error('Invalid RSS document');
  return $('item').toArray().slice(0, 30).map(element => {
    const item = $(element);
    const description = item.find('description').text();
    const descriptionHtml = load(description);
    const enclosure = item.find('enclosure').toArray().find(node => /^image\//.test($(node).attr('type') || ''));
    const image = enclosure ? $(enclosure).attr('url') : item.find('media\\:thumbnail').attr('url')
      || item.find('media\\:content').attr('url') || descriptionHtml('img').first().attr('src');
    const link = item.find('link').text();
    if (!source.hosts.includes(new URL(safeUrl(link) || source.url).hostname)) return null;
    return normalize({ title: item.find('title').text(), description, link,
      pubDate: item.find('pubDate').text(), image, tags: item.find('category').toArray().map(node => $(node).text()) }, now);
  }).filter(Boolean);
}

function contentSignature(article) {
  const { publishedAt, modifiedAt, ...content } = article;
  return JSON.stringify(content);
}

function mergeArticles(previous, fresh, curated, now) {
  const merged = new Map(previous.map(article => [article.id, article]));
  for (const article of fresh) {
    const prior = merged.get(article.id);
    if (prior?.indexable) continue;
    const next = { ...article, slug: prior?.slug || article.slug, publishedAt: prior?.publishedAt || article.publishedAt };
    next.modifiedAt = prior && contentSignature(prior) === contentSignature(next) ? prior.modifiedAt : now;
    merged.set(next.id, next);
  }
  for (const raw of curated) {
    const article = normalize(raw, now);
    if (!article?.indexable) throw new Error('Reviewed news requires a dated source and substantial original sections');
    const prior = merged.get(article.id);
    const next = { ...article, slug: prior?.slug || article.slug, publishedAt: prior?.publishedAt || now };
    next.modifiedAt = prior && contentSignature(prior) === contentSignature(next) ? prior.modifiedAt : now;
    merged.set(next.id, next);
  }
  return [...merged.values()].sort((a, b) => Number(b.indexable) - Number(a.indexable)
    || Date.parse(b.sourcePublishedAt) - Date.parse(a.sourcePublishedAt));
}

async function readResponse(response, maximum) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('News response exceeds size limit'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString('utf8');
}

function validateCatalog(data, config, now) {
  if (data.version !== 1 || data.siteUrl !== config.siteUrl || !Array.isArray(data.articles) || !Array.isArray(data.feeds))
    throw new Error('Invalid previous news archive');
  const articles = data.articles.map(raw => normalize(raw, now));
  if (articles.some(article => !article)) throw new Error('Invalid archived news entry');
  return { articles, feeds: data.feeds };
}

async function loadPrevious(config, now, fetcher, recovery = null) {
  const response = await fetcher(config.siteUrl + '/news/catalog.json', { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (response.status === 404) {
    if (!recovery) return { articles: [], feeds: [] };
    const restored = validateCatalog(recovery, config, now);
    console.warn('[news] Restoring ' + restored.articles.length + ' archived pages from the checked-in recovery checkpoint.');
    return restored;
  }
  if (!response.ok) throw new Error('Previous news archive unavailable (' + response.status + ')');
  const data = JSON.parse(await readResponse(response, 16000000));
  return validateCatalog(data, config, now);
}

async function collectFeeds(previous, now, fetcher) {
  const articles = [], feeds = [];
  for (const source of SOURCES) {
    const prior = previous.feeds.find(feed => feed.url === source.url);
    const headers = { accept: 'application/rss+xml, application/xml, text/xml' };
    if (prior?.etag) headers['If-None-Match'] = String(prior.etag).slice(0, 300);
    if (prior?.lastModified) headers['If-Modified-Since'] = String(prior.lastModified).slice(0, 100);
    try {
      const response = await fetcher(source.url, { headers, signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (response.status === 304 && prior) { feeds.push(prior); continue; }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      articles.push(...parseFeed(await readResponse(response, 2000000), source, now));
      feeds.push({ url: source.url, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') });
    } catch (error) {
      console.warn('[news] Keeping previous ' + source.name + ' entries: ' + error.message);
      if (prior) feeds.push(prior);
    }
  }
  return { articles, feeds };
}

function siteConfig(root) {
  const host = fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim();
  const siteUrl = new URL(host.includes('://') ? host : 'https://' + host).origin;
  const fraja = new URL(siteUrl).hostname === 'fraja.online';
  return { siteUrl, brand: fraja ? 'Fraja | فرجة' : 'koratv', logo: fraja ? '/assets/images/fraja-logo.svg' : '/assets/images/logo-header.webp' };
}

const articlePath = article => '/news/' + encodeURIComponent(article.slug) + '/';
const dateText = value => new Intl.DateTimeFormat('ar-MA-u-nu-latn', {
  timeZone: 'Africa/Casablanca', dateStyle: 'long', timeStyle: 'short'
}).format(new Date(value));

function renderCard(article, breaking = false) {
  const href = articlePath(article);
  return '<article class="' + (breaking ? 'breaking-news-card' : 'news-card') + '" data-news-id="' + article.id + '">'
    + '<a class="news-image-wrapper news-image-link" href="' + href + '" tabindex="-1" aria-hidden="true">'
    + (article.image ? '<img src="' + esc(article.image) + '" alt="" width="640" height="360" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '<span class="news-no-image" aria-hidden="true"></span>') + '</a>'
    + '<div class="news-content"><h3 class="news-title"><a href="' + href + '">' + esc(article.title) + '</a></h3>'
    + (article.summary ? '<p class="news-summary">' + esc(article.summary) + '</p>' : '')
    + '<div class="news-meta"><time datetime="' + esc(article.sourcePublishedAt) + '">' + esc(dateText(article.sourcePublishedAt)) + '</time>'
    + '<a class="read-more-link" href="' + href + '">اقرأ <i class="fas fa-arrow-left" aria-hidden="true"></i></a></div></div></article>';
}

function shell(config, title, description, canonical, body, extra = '') {
  return ['<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' | ' + esc(config.brand) + '</title>',
    '<meta name="description" content="' + esc(description) + '"><link rel="canonical" href="' + esc(canonical) + '">',
    '<link rel="icon" href="' + esc(config.logo) + '"><link rel="stylesheet" href="/assets/css/fonts.css">',
    '<link rel="stylesheet" href="/assets/css/news.css"><link rel="stylesheet" href="/assets/css/article.css?v=20261018">',
    '<meta property="og:site_name" content="' + esc(config.brand) + '"><meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '"><meta property="og:url" content="' + esc(canonical) + '">',
    extra, '</head><body class="article-page"><header class="article-header"><a class="article-brand" href="/"><img src="' + esc(config.logo) + '" width="40" height="40" alt="">' + esc(config.brand) + '</a>',
    '<nav aria-label="التنقل"><a href="/">نتائج المباريات</a><a href="/news.html">الأخبار</a><a href="/news/archive/">الأرشيف</a></nav></header>',
    body, '<footer class="article-footer"><a href="/news.html">أخبار كرة القدم</a><a href="/">جدول المباريات والنتائج</a><span>' + esc(config.brand) + ' © ' + new Date().getUTCFullYear() + '</span></footer></body></html>'
  ].join('\n');
}

function renderArticle(article, config, related) {
  const canonical = config.siteUrl + articlePath(article);
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': article.indexable ? 'NewsArticle' : 'WebPage', '@id': canonical + '#article',
      headline: article.title, name: article.title, description: article.summary, inLanguage: 'ar',
      mainEntityOfPage: canonical, datePublished: article.publishedAt, dateModified: article.modifiedAt,
      ...(article.image ? { image: [article.image] } : {}),
      ...(article.indexable ? { author: { '@type': 'Organization', name: config.brand, url: config.siteUrl + '/news.html' } } : {}),
      publisher: { '@type': 'Organization', name: config.brand, url: config.siteUrl + '/', logo: { '@type': 'ImageObject', url: config.siteUrl + config.logo } },
      citation: article.sourceUrl },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: config.brand, item: config.siteUrl + '/' },
      { '@type': 'ListItem', position: 2, name: 'الأخبار', item: config.siteUrl + '/news.html' },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonical }
    ] }
  ] };
  const extra = '<meta name="robots" content="' + (article.indexable ? 'index' : 'noindex') + ',follow,max-image-preview:large">'
    + '<meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image">'
    + (article.image ? '<meta property="og:image" content="' + esc(article.image) + '">' : '')
    + '<script type="application/ld+json">' + JSON.stringify(schema).replace(/</g, '\\u003c') + '</script>';
  const body = '<main class="article-layout"><article class="news-story"><nav class="article-breadcrumb" aria-label="مسار الصفحة"><a href="/news.html">الأخبار</a><span> / </span>' + esc(article.sourceName) + '</nav>'
    + '<p class="article-kicker">' + (article.indexable ? 'موجز تحريري' : 'من الصحافة الرياضية') + '</p><h1>' + esc(article.title) + '</h1>'
    + '<div class="article-meta"><span>' + (article.indexable ? 'إعداد ' + esc(config.brand) : 'المصدر: ' + esc(article.sourceName)) + '</span><time datetime="' + article.publishedAt + '">نشر: ' + esc(dateText(article.publishedAt)) + '</time></div>'
    + (article.image ? '<figure class="article-figure"><img src="' + esc(article.image) + '" width="1200" height="675" alt="' + esc(article.title) + '" fetchpriority="high" referrerpolicy="no-referrer"><figcaption>صورة الخبر من ' + esc(article.sourceName) + '</figcaption></figure>' : '')
    + (article.summary ? '<p class="article-lead">' + esc(article.summary) + '</p>' : '')
    + article.sections.map(section => '<section>' + (section.heading ? '<h2>' + esc(section.heading) + '</h2>' : '') + '<p>' + esc(section.text) + '</p></section>').join('')
    + (article.facts.length ? '<section><h2>أبرز المعطيات</h2><dl class="article-facts">' + article.facts.map(fact => '<div><dt>' + esc(fact.label) + '</dt><dd>' + esc(fact.value) + '</dd></div>').join('') + '</dl></section>' : '')
    + '<section class="article-source"><h2>المصدر</h2><p>' + (article.indexable ? 'صياغة موجزة اعتمادًا على التقرير المنشور لدى ' : 'مقتطف قصير من خبر منشور لدى ') + esc(article.sourceName) + ' بتاريخ <time datetime="' + article.sourcePublishedAt + '">' + esc(dateText(article.sourcePublishedAt)) + '</time>.</p><a href="' + esc(article.sourceUrl) + '" target="_blank" rel="noopener noreferrer">قراءة التقرير الأصلي لدى ' + esc(article.sourceName) + '</a></section></article>'
    + '<aside class="article-related"><h2>اقرأ أيضًا</h2><ul>' + related.map(item => '<li><a href="' + articlePath(item) + '">' + esc(item.title) + '</a><small>' + esc(item.sourceName) + '</small></li>').join('') + '</ul><a href="/news.html">كل الأخبار</a></aside></main>';
  return shell(config, article.title, article.summary || article.title, canonical, body, extra);
}

function writeSitemaps(output, config, articles) {
  const filename = path.join(output, 'sitemap.xml');
  const $ = load(fs.readFileSync(filename, 'utf8'), { xmlMode: true });
  if (!$('urlset').length) throw new Error('Expected a public URL sitemap');
  const urls = new Map($('url').toArray().map(element => [$(element).find('loc').text(), $(element).find('lastmod').text()]));
  for (const url of [...urls.keys()]) if (url.startsWith(config.siteUrl + '/news/')) urls.delete(url);
  const entries = articles.filter(article => article.indexable).map(article => [config.siteUrl + articlePath(article), article.modifiedAt]);
  if (entries.length) entries.push([config.siteUrl + '/news/archive/', entries.map(item => item[1]).sort().at(-1)]);
  for (const [url, modified] of entries) urls.set(url, modified);
  const xml = list => '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + list.map(([url, modified]) => '<url><loc>' + esc(url) + '</loc>' + (modified ? '<lastmod>' + esc(modified) + '</lastmod>' : '') + '</url>').join('') + '</urlset>';
  fs.writeFileSync(filename, xml([...urls]));
  fs.writeFileSync(path.join(output, 'sitemap-articles.xml'), xml(entries));
  const robots = path.join(output, 'robots.txt');
  const current = fs.existsSync(robots) ? fs.readFileSync(robots, 'utf8') : 'User-agent: *\nAllow: /\n';
  if (!current.includes(config.siteUrl + '/sitemap-articles.xml')) fs.writeFileSync(robots, current.trimEnd() + '\nSitemap: ' + config.siteUrl + '/sitemap-articles.xml\n');
}

function writeNews(output, config, articles, feeds) {
  fs.mkdirSync(path.join(output, 'news'), { recursive: true });
  for (const article of articles) {
    const directory = path.join(output, 'news', article.slug);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), renderArticle(article, config, articles.filter(item => item.id !== article.id).slice(0, 5)));
  }
  const archiveDir = path.join(output, 'news/archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archiveBody = '<main class="news-archive"><h1>أرشيف الأخبار الرياضية</h1><ul class="news-archive-list">' + articles.map(article => '<li><a href="' + articlePath(article) + '">' + esc(article.title) + '</a><small>' + esc(article.sourceName) + ' · ' + esc(dateText(article.sourcePublishedAt)) + '</small></li>').join('') + '</ul></main>';
  fs.writeFileSync(path.join(archiveDir, 'index.html'), shell(config, 'أرشيف الأخبار الرياضية', 'الأخبار والملخصات الرياضية المنشورة على ' + config.brand, config.siteUrl + '/news/archive/', archiveBody, '<meta name="robots" content="index,follow">'));
  const catalog = { version: 1, siteUrl: config.siteUrl, articles, feeds };
  const serialized = JSON.stringify(catalog);
  if (Buffer.byteLength(serialized) > 16000000) throw new Error('News archive exceeds safe publication size');
  fs.writeFileSync(path.join(output, 'news/catalog.json'), serialized);
  fs.writeFileSync(path.join(output, 'news/feed.json'), JSON.stringify({ version: 1, articles: articles.slice(0, 60).map(article => ({
    id: article.id, title: article.title, description: article.summary, path: articlePath(article),
    link: article.sourceUrl, image: article.image, pubDate: article.sourcePublishedAt, sourceName: article.sourceName, tags: article.tags
  })) }));
  for (const file of ['index.html', 'news.html']) {
    const target = path.join(output, file);
    if (!fs.existsSync(target)) continue;
    const $ = load(fs.readFileSync(target, 'utf8'));
    if (!$('link[data-news-cards]').length) $('head').append('<link rel="stylesheet" data-news-cards href="/assets/css/news-cards.css?v=20261018">');
    if (file === 'index.html') $('#news-grid-container').html(articles.slice(0, 9).map(article => renderCard(article)).join(''));
    else {
      $('.breaking-news-section .section-title').text('مختارات الأخبار');
      $('#news-hero-title').text('أخبار كرة القدم والبطولات');
      $('#breaking-news').html(articles.slice(0, 3).map(article => renderCard(article, true)).join(''));
      $('#sports-news').html(articles.slice(3, 12).map(article => renderCard(article)).join(''));
      $('.footer-extra-links').remove();
      $('.footer-logo a').attr('href', '/').text(config.brand);
      $('.copyright p').text('© ' + new Date().getUTCFullYear() + ' ' + config.brand);
      $('.news-archive-link').remove();
      $('main').append('<a class="news-archive-link" href="/news/archive/">أرشيف الأخبار الرياضية</a>');
    }
    $('script[data-news-list]').remove();
    const listSchema = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: articles.slice(0, file === 'index.html' ? 9 : 12).map((article, index) => ({
      '@type': 'ListItem', position: index + 1, name: article.title, url: config.siteUrl + articlePath(article)
    })) };
    $('head').append($('<script>').attr({ type: 'application/ld+json', 'data-news-list': '' }).text(JSON.stringify(listSchema).replace(/</g, '\\u003c')));
    fs.writeFileSync(target, $.html());
  }
  writeSitemaps(output, config, articles);
}

async function generateNews({ root = path.resolve(__dirname, '..'), output = path.join(root, '_site'),
  now = new Date().toISOString(), fetcher = fetch, previous, fresh, curated } = {}) {
  const config = siteConfig(root);
  const recoveryFile = path.join(root, 'content/news/archive-seed.json');
  const recovery = fs.existsSync(recoveryFile) ? JSON.parse(fs.readFileSync(recoveryFile, 'utf8')) : null;
  const prior = previous || await loadPrevious(config, now, fetcher, recovery);
  const collected = fresh ? { articles: fresh, feeds: prior.feeds } : await collectFeeds(prior, now, fetcher);
  const reviewed = curated || JSON.parse(fs.readFileSync(path.join(root, 'content/news/editorial.json'), 'utf8'));
  const articles = mergeArticles(prior.articles, collected.articles, reviewed, now);
  if (!articles.length) throw new Error('Refusing to publish an empty news archive');
  writeNews(output, config, articles, collected.feeds);
  instrumentPublicPages(output, measurementIdFromHomepage(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
  console.log('Published ' + articles.length + ' internal news pages; ' + articles.filter(article => article.indexable).length + ' reviewed articles in the sitemap.');
  return { articles, config };
}

module.exports = { SOURCES, safeUrl, sourceUrl, normalize, parseFeed, mergeArticles, loadPrevious, collectFeeds, articlePath, renderArticle, writeNews, generateNews };
if (require.main === module) generateNews().catch(error => { console.error('[news] ' + error.message); process.exitCode = 1; });
