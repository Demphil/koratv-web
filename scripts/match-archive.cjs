const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { load } = require('cheerio');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const safeSlug = value => typeof value === 'string' && value.length <= 200 && /^[\p{L}\p{N}_-]+$/u.test(value);
const id = row => hash(row.match_id || row.id || '');
const groupSlug = name => hash(name.normalize('NFKC').trim()).slice(0, 20);

async function fetchText(url, optional = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (optional && response.status === 404) return null;
      if (!response.ok) throw new Error(`Archive fetch failed (${response.status}): ${url}`);
      const text = await response.text();
      if (Buffer.byteLength(text) > 48 * 1024 * 1024) throw new Error('Archive exceeds safe build size');
      return text;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

function validateEntry(entry, config) {
  if (!entry || !safeSlug(entry.slug) || typeof entry.html !== 'string') throw new Error('Invalid archive entry');
  const $ = load(entry.html);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (decodeURI(canonical || '') !== `${config.siteUrl}/match/${entry.slug}/`) throw new Error('Archive canonical mismatch');
  if (!$('main.match-detail').length) throw new Error('Archive page is not a match result');
  if ($('script:not([type="application/ld+json"]),iframe,object,embed,form').length
    || /\bon\w+\s*=|javascript:|\/api\/operator\/|sb_secret_|PRIVATE KEY/.test(entry.html)) throw new Error('Unsafe archive HTML');
  return entry;
}

function metadata(page, identity = null) {
  const $ = load(page.html);
  const teams = $('h1').first().text().split(' ضد ');
  const score = $('.scoreline > span').text().replace(teams[0] || '', '').replace(teams.slice(1).join(' ضد '), '').trim();
  return {
    slug: page.slug, identity, home: teams[0] || '', away: teams.slice(1).join(' ضد '),
    league: $('.meta').first().text().split(' · ')[0].trim(),
    date: page.date || page.slug.match(/(\d{4}-\d{2}-\d{2})-[^-]+$/)?.[1] || '',
    logo: /^https:\/\//.test($('.scoreline img').first().attr('src') || '') ? $('.scoreline img').first().attr('src') : '',
    summary: /^\d+\s*-\s*\d+$/.test(score) ? score : 'لا توجد نتيجة مسجلة', lastmod: page.lastmod || '', html: page.html
  };
}

async function loadArchive(config) {
  const previous = await fetchText(`${config.siteUrl}/archive/catalog.json?build=${Date.now()}`, true);
  if (previous !== null) {
    const data = JSON.parse(previous);
    if (data.version === 2 && Array.isArray(data.shards)) {
      data.pages = [];
      for (const shard of data.shards) {
        if (!/^(?:\d{4}-\d{2}|undated)-[a-f0-9]{16}\.json$/.test(shard.file)) throw new Error('Invalid archive shard');
        const text = await fetchText(`${config.siteUrl}/archive/data/${shard.file}`);
        if (hash(text) !== shard.hash) throw new Error('Archive shard checksum mismatch');
        const pages = JSON.parse(text);
        if (!Array.isArray(pages) || pages.length !== shard.count) throw new Error('Archive shard count mismatch');
        data.pages.push(...pages);
      }
    }
    if (![1, 2].includes(data.version) || !Array.isArray(data.pages) || !Array.isArray(data.aliases)) throw new Error('Invalid archive catalog');
    data.pages.forEach(entry => validateEntry(entry, config));
    for (const alias of data.aliases) if (!safeSlug(alias.slug) || !safeSlug(alias.target)) throw new Error('Invalid archive alias');
    return data;
  }
  // Bootstrap from pages that are already public, before the rolling database drops them.
  const xml = await fetchText(`${config.siteUrl}/sitemap.xml`);
  const $ = load(xml, { xmlMode: true });
  const pages = [];
  const missing = [];
  for (const element of $('url').toArray()) {
    const url = new URL($(element).find('loc').text());
    if (url.origin !== config.siteUrl || !url.pathname.startsWith('/match/')) continue;
    const slug = decodeURIComponent(url.pathname.split('/')[2] || '');
    if (!safeSlug(slug)) throw new Error('Unsafe sitemap match path');
    const html = await fetchText(url.href, true);
    if (html === null) { missing.push(url.href); continue; }
    const entry = metadata({ slug, html, lastmod: $(element).find('lastmod').text() });
    pages.push(validateEntry(entry, config));
  }
  console.log(`Archive bootstrap: ${pages.length} existing pages preserved; ${missing.length} already missing.`);
  return { version: 1, pages, aliases: [] };
}

function restoreSlugs(rows, archive) {
  const existing = new Map(archive.pages.filter(page => page.identity).map(page => [page.identity, page.slug]));
  return rows.map(row => existing.has(id(row)) ? { ...row, archiveSlug: existing.get(id(row)) } : row);
}

function shell(config, route, title, content, indexable = true) {
  const canonical = `${config.siteUrl}${route}`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | ${esc(config.brand)}</title><meta name="description" content="${esc(title)}: مواعيد المباريات والنتائج والإحصائيات المتوفرة على ${esc(config.brand)}."><meta name="robots" content="${indexable ? 'index' : 'noindex'},follow"><link rel="canonical" href="${canonical}"><link rel="stylesheet" href="/assets/css/matches.css"><link rel="stylesheet" href="/assets/css/archive.css"></head><body class="results-archive"><header><a href="/">${esc(config.brand)}</a><nav aria-label="التنقل"><a href="/">مباريات اليوم</a><a href="/archive/">الأرشيف</a><a href="/competitions/">البطولات</a><a href="/teams/">الفرق والمنتخبات</a></nav></header><main><h1>${esc(title)}</h1>${content}</main></body></html>`;
}

function resultList(pages) {
  return `<ul class="result-list">${pages.map(page => `<li><a href="/match/${encodeURIComponent(page.slug)}/"><strong>${page.logo ? `<img src="${esc(page.logo)}" width="32" height="32" loading="lazy" alt=""> ` : ''}${esc(page.home)} ضد ${esc(page.away)}</strong><span>${esc(page.summary)}</span><small>${esc(page.date)} · ${esc(page.league)}</small></a></li>`).join('')}</ul>`;
}

function writeArchive(output, config, archive, freshPages, rows) {
  const merged = new Map(archive.pages.map(page => [page.slug, page]));
  const rowsBySlug = new Map(rows.map(row => [row.archiveSlug || '', row]));
  for (const page of freshPages) {
    const entry = metadata(page, page.identity || (rowsBySlug.has(page.slug) ? id(rowsBySlug.get(page.slug)) : null));
    const prior = merged.get(page.slug);
    // Database refresh timestamps are not necessarily content changes.
    if (prior && prior.html === entry.html) entry.lastmod = prior.lastmod;
    merged.set(page.slug, entry);
  }
  for (const alias of archive.aliases) if (alias.slug !== alias.target && merged.has(alias.target)) merged.delete(alias.slug);
  const pages = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const entries = [];
  const write = (route, html, lastmod, indexable = true) => {
    const filename = path.join(output, route, 'index.html');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, html);
    if (indexable) entries.push({ loc: `${config.siteUrl}/${route}/`, lastmod });
  };
  const latest = list => list.map(page => page.lastmod).filter(Boolean).sort().at(-1);
  for (const page of pages) {
    const $ = load(page.html);
    $('main .archive-links, main .archive-snapshot').remove();
    $('.meta').first().text($('.meta').first().text().replace('مباراة جارية', 'آخر حالة مسجلة: مباراة جارية'));
    for (const element of $('meta[name="description"],meta[property="og:description"]').toArray()) {
      $(element).attr('content', ($(element).attr('content') || '').replace('النتيجة الحالية:', 'النتيجة المسجلة:'));
    }
    $('main').append(`<p class="archive-snapshot">بيانات مسجلة عند آخر تحديث: ${esc(page.lastmod || page.date)}. حالة المباراة والنتيجة تخص ذلك التحديث.</p><nav class="archive-links"><a href="/archive/">أرشيف النتائج</a> · <a href="/competitions/${groupSlug(page.league)}/">${esc(page.league)}</a> · <a href="/teams/${groupSlug(page.home)}/">${esc(page.home)}</a> · <a href="/teams/${groupSlug(page.away)}/">${esc(page.away)}</a></nav>`);
    write(`match/${page.slug}`, $.html(), page.lastmod);
  }
  for (const alias of archive.aliases) {
    if (merged.has(alias.slug) || !merged.has(alias.target)) continue;
    const target = `${config.siteUrl}/match/${alias.target}/`;
    const directory = path.join(output, 'match', alias.slug);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><html lang="ar"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${esc(target)}"><link rel="canonical" href="${esc(target)}"><title>تفاصيل المباراة</title></head><body><a href="${esc(target)}">تفاصيل المباراة</a></body></html>`);
  }
  const months = new Map();
  for (const page of pages) {
    const month = page.date.slice(0, 7) || 'undated';
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(page);
  }
  for (const [month, list] of months) write(`archive/${month}`, shell(config, `/archive/${month}/`, `نتائج المباريات ${month}`, resultList(list)), latest(list));
  write('archive', shell(config, '/archive/', 'أرشيف المباريات والنتائج', `<ul class="directory-list">${[...months].map(([month, list]) => `<li><a href="/archive/${month}/">${esc(month)} <small>${list.length} مباراة</small></a></li>`).join('')}</ul>${resultList(pages.slice(0, 30))}`), latest(pages));
  for (const [section, title, names] of [
    ['competitions', 'البطولات', page => [page.league]],
    ['teams', 'الفرق والمنتخبات', page => [page.home, page.away]]
  ]) {
    const groups = new Map();
    for (const page of pages) for (const name of new Set(names(page).filter(Boolean))) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(page);
    }
    for (const [name, list] of groups) {
      const route = `${section}/${groupSlug(name)}`;
      // One-fixture directories add no search value beyond their match page.
      const indexable = list.length > 1;
      for (let offset = 0; offset < list.length; offset += 100) {
        const number = offset / 100 + 1;
        const suffix = number === 1 ? '' : `/page-${number}`;
        const links = Array.from({ length: Math.ceil(list.length / 100) }, (_, n) => `<a href="/${route}${n ? `/page-${n + 1}` : ''}/">${n + 1}</a>`).join(' ');
        write(route + suffix, shell(config, `/${route}${suffix}/`, `مباريات ونتائج ${name}${number > 1 ? ` - ${number}` : ''}`, resultList(list.slice(offset, offset + 100)) + `<nav aria-label="صفحات النتائج">${links}</nav>`, indexable), latest(list), indexable);
      }
    }
    write(section, shell(config, `/${section}/`, title, `<ul class="directory-list">${[...groups].sort(([a], [b]) => a.localeCompare(b, 'ar')).map(([name, list]) => `<li><a href="/${section}/${groupSlug(name)}/">${esc(name)} <small>${list.length} مباراة</small></a></li>`).join('')}</ul>`), latest(pages));
  }
  const shards = [];
  fs.mkdirSync(path.join(output, 'archive/data'), { recursive: true });
  for (const [month, list] of months) {
    const text = JSON.stringify(list);
    const checksum = hash(text);
    const file = `${month}-${checksum.slice(0, 16)}.json`;
    fs.writeFileSync(path.join(output, 'archive/data', file), text);
    shards.push({ file, hash: checksum, count: list.length });
  }
  fs.writeFileSync(path.join(output, 'archive/catalog.json'), JSON.stringify({ version: 2, shards, aliases: archive.aliases }));
  const sitemap = path.join(output, 'sitemap.xml');
  const $xml = load(fs.readFileSync(sitemap, 'utf8'), { xmlMode: true });
  const staticEntries = $xml('url').toArray().map(element => ({ loc: $xml(element).find('loc').text() }))
    .filter(entry => [config.siteUrl + '/', config.siteUrl + '/news.html'].includes(entry.loc));
  const xml = list => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${list.map(entry => `<url><loc>${esc(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${esc(entry.lastmod)}</lastmod>` : ''}</url>`).join('')}</urlset>`;
  fs.writeFileSync(sitemap, xml([...staticEntries, ...entries]));
  const homepage = path.join(output, 'index.html');
  if (fs.existsSync(homepage)) {
    const $ = load(fs.readFileSync(homepage, 'utf8'));
    $('.archive-directory-links').remove();
    const nav = '<nav class="archive-directory-links" aria-label="النتائج والبطولات"><a href="/archive/">أرشيف النتائج</a> · <a href="/competitions/">البطولات</a> · <a href="/teams/">الفرق والمنتخبات</a></nav>';
    if ($('footer').length) $('footer').first().prepend(nav); else $('body').append(nav);
    fs.writeFileSync(homepage, $.html());
  }
  return { count: pages.length, urls: entries.length };
}

module.exports = { loadArchive, restoreSlugs, writeArchive, metadata, id, validateEntry, groupSlug };
