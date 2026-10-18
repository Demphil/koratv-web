const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');

function measurementIdFromHomepage(html) {
  const $ = load(html);
  const ids = $('script[src]').toArray().flatMap(element => {
    try {
      const url = new URL($(element).attr('src'));
      return url.origin === 'https://www.googletagmanager.com' && url.pathname === '/gtag/js'
        ? [url.searchParams.get('id')] : [];
    } catch { return []; }
  });
  const unique = [...new Set(ids)];
  if (unique.length !== 1 || !/^G-[A-Z0-9]{6,}$/.test(unique[0])) throw new Error('One valid public Analytics measurement ID is required');
  return unique[0];
}

function instrumentPage(html, measurementId) {
  if (!/^G-[A-Z0-9]{6,}$/.test(measurementId)) throw new Error('Invalid measurement ID');
  const $ = load(html);
  if ($('meta[http-equiv]').toArray().some(element => /refresh/i.test($(element).attr('http-equiv')))) return html;
  if (!$('link[rel="canonical"]').length) return html;
  const bootstrap = $('script[data-site-metrics]').attr('data-bootstrap') === 'true';
  $('script[data-site-metrics]').remove();
  const tags = $('script[src]').toArray().filter(element => {
    try {
      const url = new URL($(element).attr('src'));
      return url.origin === 'https://www.googletagmanager.com' && url.pathname === '/gtag/js';
    } catch { return false; }
  });
  for (const element of tags) {
    if (new URL($(element).attr('src')).searchParams.get('id') !== measurementId) throw new Error('Analytics destination mismatch');
  }
  if (!tags.length) {
    $('head').append($('<script>').attr({ async: '', src: 'https://www.googletagmanager.com/gtag/js?id=' + measurementId }));
  }
  $('head').append($('<script>').attr({
    defer: '', src: '/assets/js/site-metrics.js?v=20261018',
    'data-site-metrics': '', 'data-measurement-id': measurementId,
    'data-bootstrap': bootstrap || !tags.length ? 'true' : 'false'
  }));
  return $.html();
}

function instrumentPublicPages(output, measurementId) {
  const files = ['index.html', 'news.html'];
  for (const directory of ['news', 'match', 'archive', 'teams', 'competitions']) {
    const visit = folder => {
      if (!fs.existsSync(folder)) return;
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const target = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.isFile() && entry.name === 'index.html') files.push(path.relative(output, target));
      }
    };
    visit(path.join(output, directory));
  }
  let count = 0;
  for (const file of files) {
    const target = path.join(output, file);
    if (!fs.existsSync(target)) continue;
    const before = fs.readFileSync(target, 'utf8');
    const after = instrumentPage(before, measurementId);
    if (after !== before) { fs.writeFileSync(target, after); count++; }
  }
  return count;
}

module.exports = { measurementIdFromHomepage, instrumentPage, instrumentPublicPages };
