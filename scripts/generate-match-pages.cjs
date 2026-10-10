const fs = require('node:fs');
const path = require('node:path');
const { sameFixture, deduplicateSourceEvents } = require('../shared/match-broadcasts.mjs');
const { sourceMatchState } = require('../shared/match-lifecycle.mjs');
const { isAllowedMatch, isGulfCupLeague } = require('../shared/league-whitelist.mjs');
const { prerenderHomepage } = require('./prerender-match-list.cjs');
const { loadArchive, restoreSlugs, writeArchive, id: archiveId } = require('./match-archive.cjs');

const root = path.resolve(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function idHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function matchSlug(match) {
  if (match.archiveSlug && /^[\p{L}\p{N}_-]{1,200}$/u.test(match.archiveSlug)) return match.archiveSlug;
  const home = String(match.home_team || match.homeTeam?.name || match.homeTeam || '')
    .normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLocaleLowerCase('ar').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const away = String(match.away_team || match.awayTeam?.name || match.awayTeam || '')
    .normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLocaleLowerCase('ar').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const kickoff = safeDate(match.kickoff_time || match.scheduledAt);
  const date = kickoff ? kickoff.toISOString().slice(0, 10) : 'match';
  return `${home}-${away}-${date}-${idHash(match.match_id || match.matchId || match.id)}`.slice(0, 180);
}

function siteConfig() {
  const configured = process.env.SITE_URL || fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim();
  const siteUrl = new URL(configured.includes('://') ? configured : `https://${configured}`).origin;
  const isFraja = new URL(siteUrl).hostname.endsWith('frajatv.fun');
  return { siteUrl, brand: isFraja ? 'فرجة' : 'koratv' };
}

function visibleStatistics(payload) {
  const groups = Array.isArray(payload?.statistics) ? payload.statistics : [];
  return groups.flatMap((group) => (Array.isArray(group?.statistics) ? group.statistics : [])
    .filter((item) => item?.type && item.value !== null && item.value !== undefined && item.value !== '')
    .map((item) => ({
      label: `${group.team?.name ? `${group.team.name} - ` : ''}${item.type}`,
      value: String(item.value)
    })));
}

function matchPage(row, config) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const home = String(row.home_team || payload.homeTeam?.name || payload.homeTeam || '').trim();
  const away = String(row.away_team || payload.awayTeam?.name || payload.awayTeam || '').trim();
  const kickoff = safeDate(row.kickoff_time || payload.scheduledAt);
  if (!home || !away || !kickoff) return null;

  const dateText = new Intl.DateTimeFormat('ar-MA', {
    timeZone: 'Africa/Casablanca', dateStyle: 'full'
  }).format(kickoff);
  const timeText = new Intl.DateTimeFormat('ar-MA', {
    timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(kickoff);
  const title = `${home} ضد ${away}: الموعد والنتيجة والإحصاءات | ${config.brand}`;
  const league = String(row.league || payload.league || '').trim();
  const state = sourceMatchState(payload);
  const score = String(payload.score || (state === 'upcoming' ? 'لم تبدأ المباراة' : 'النتيجة غير متوفرة')).trim();
  const status = state === 'ended' ? 'انتهت المباراة' : state === 'live' ? 'مباراة جارية' : 'موعد المباراة';
  const description = `${status}: ${home} ضد ${away}${league ? ` ضمن ${league}` : ''}. الموعد ${dateText} الساعة ${timeText} بتوقيت المغرب. النتيجة الحالية: ${score}.`;
  const canonical = `${config.siteUrl}/match/${matchSlug(row)}/`;
  const stats = visibleStatistics(payload);
  const goals = Array.isArray(payload.goals) ? payload.goals.filter((goal) => goal?.player) : [];
  const events = Array.isArray(payload.events) ? payload.events.filter((event) => event && (event.detail || event.player || event.type)) : [];
  const homeLogo = payload.homeLogo || payload.homeTeam?.logo || '';
  const awayLogo = payload.awayLogo || payload.awayTeam?.logo || '';
  const eventRows = [...goals, ...events].slice(0, 30).map((event) => {
    const label = [event.minute ? `${event.minute}'` : '', event.player || event.detail || event.type || 'حدث المباراة']
      .filter(Boolean).join(' - ');
    return `<li>${escapeHtml(label)}</li>`;
  }).join('');
  const statRows = stats.slice(0, 50).map((item) => `<tr><th scope="row">${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)}</td></tr>`).join('');
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: title, description, inLanguage: 'ar',
        isPartOf: { '@id': `${config.siteUrl}/#website` }, publisher: { '@id': `${config.siteUrl}/#organization` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: config.brand, item: `${config.siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: `${home} ضد ${away}`, item: canonical }
      ] }
    ]
  };

  return {
    slug: matchSlug(row),
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(kickoff),
    lastmod: safeDate(row.updated_at)?.toISOString().slice(0, 10) || kickoff.toISOString().slice(0, 10),
    html: `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeHtml(config.brand)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
<link rel="stylesheet" href="/assets/css/matches.css">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
<style>
body{padding-top:0}.match-detail{max-width:1000px;margin:32px auto;padding:24px;background:rgba(24,32,51,.62);border:1px solid rgba(217,184,108,.22);border-radius:12px;color:#f1faee}.match-detail h1{text-align:center;font-size:clamp(1.4rem,4vw,2rem)}.match-detail .meta{text-align:center;line-height:1.9;color:#d9b86c}.match-detail .scoreline{display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;margin:28px 0;font-size:1.35rem;font-weight:700}.match-detail .scoreline img{width:48px;height:48px;object-fit:contain}.match-detail section{margin-top:28px}.match-detail table{width:100%;border-collapse:collapse}.match-detail th,.match-detail td{text-align:right;padding:10px;border-bottom:1px solid rgba(255,255,255,.12)}.match-detail a{color:#d9b86c}.match-detail-back{display:inline-block;margin-top:24px}
</style></head><body><main class="match-detail">
<p class="meta">${escapeHtml(league || 'مباراة كرة القدم')} · ${escapeHtml(status)}</p>
<h1>${escapeHtml(home)} ضد ${escapeHtml(away)}</h1>
<div class="scoreline">${homeLogo ? `<img src="${escapeHtml(homeLogo)}" alt="${escapeHtml(home)}" loading="lazy">` : ''}<span>${escapeHtml(home)} ${escapeHtml(score)} ${escapeHtml(away)}</span>${awayLogo ? `<img src="${escapeHtml(awayLogo)}" alt="${escapeHtml(away)}" loading="lazy">` : ''}</div>
<p class="meta">${escapeHtml(dateText)} · ${escapeHtml(timeText)} بتوقيت المغرب</p>
${eventRows ? `<section><h2>أحداث المباراة</h2><ul>${eventRows}</ul></section>` : ''}
${statRows ? `<section><h2>إحصاءات المباراة</h2><table><tbody>${statRows}</tbody></table></section>` : ''}
<a class="match-detail-back" href="/">العودة إلى جدول المباريات</a>
</main></body></html>`
  };
}

async function loadMatches() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const table = process.env.SUPABASE_MATCHES_TABLE || 'matches';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Invalid matches table name');
  const now = Date.now();
  const from = new Date(now - 7 * DAY_MS).toISOString();
  const to = new Date(now + 14 * DAY_MS).toISOString();
  const url = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`);
  url.searchParams.set('select', 'id,match_id,source,home_team,away_team,league,channel,kickoff_time,payload,active,updated_at');
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('and', `(kickoff_time.gte.${from},kickoff_time.lte.${to})`);
  url.searchParams.set('order', 'kickoff_time.asc');
  url.searchParams.set('limit', '1000');
  const response = await fetch(url, { headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json'
  }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Supabase match fetch failed (${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows.filter((row) => {
    const kickoff = safeDate(row.kickoff_time)?.getTime();
    return kickoff >= now - 7 * DAY_MS && kickoff <= now + 14 * DAY_MS;
  }) : [];
}

async function generate(outputDir = path.join(root, '_site'), rows) {
  const config = siteConfig();
  const archive = rows ? { version: 1, pages: [], aliases: [] } : await loadArchive(config);
  const matches = restoreSlugs(rows || await loadMatches(), archive);
  fs.mkdirSync(outputDir, { recursive: true });
  const selected = selectIndexableMatches(matches);
  const pages = selected.map((row) => {
    const page = matchPage(row, config);
    return page ? { ...page, identity: archiveId(row) } : null;
  }).filter(Boolean);
  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.slug)) continue;
    seen.add(page.slug);
    const directory = path.join(outputDir, 'match', page.slug);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), page.html);
  }
  // Keep existing bilingual URLs usable, but consolidate their indexing signals.
  for (const row of matches) {
    const canonical = selected.find(candidate => sameFixture(candidate, row));
    if (!canonical || matchSlug(canonical) === matchSlug(row) || !matchPage(row, config)) continue;
    const target = `${config.siteUrl}/match/${matchSlug(canonical)}/`;
    archive.aliases = archive.aliases.filter(alias => alias.slug !== matchSlug(row));
    archive.aliases.push({ slug: matchSlug(row), target: matchSlug(canonical) });
    const directory = path.join(outputDir, 'match', matchSlug(row));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><html lang="ar"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escapeHtml(target)}"><link rel="canonical" href="${escapeHtml(target)}"><title>${escapeHtml(config.brand)}</title></head><body><a href="${escapeHtml(target)}">تفاصيل المباراة</a></body></html>`);
  }
  const homepage = path.join(outputDir, 'index.html');
  if (fs.existsSync(homepage)) fs.writeFileSync(homepage,
    prerenderHomepage(fs.readFileSync(homepage, 'utf8'), selectHomepageMatches(selected), matchSlug));

  const staticSitemap = path.join(outputDir, 'sitemap.xml');
  const currentSitemap = fs.existsSync(staticSitemap) ? fs.readFileSync(staticSitemap, 'utf8') : '';
  const staticEntries = [...currentSitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)]
    .map((match) => match[1])
    .filter((entry) => {
      const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
      return loc === `${config.siteUrl}/` || loc === `${config.siteUrl}/news.html`;
    });
  const matchEntries = pages.filter((page, index) => pages.findIndex((candidate) => candidate.slug === page.slug) === index)
    .map((page) => `  <url><loc>${config.siteUrl}/match/${page.slug}/</loc><lastmod>${page.lastmod}</lastmod></url>`);
  fs.writeFileSync(staticSitemap,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticEntries, ...matchEntries].map((entry) => `  <url>${entry.replace(/^\s*<url>|<\/url>\s*$/g, '')}</url>`).join('\n')}\n</urlset>\n`);
  console.log(`Generated ${seen.size} match pages for ${config.siteUrl}.`);
  const retained = writeArchive(outputDir, config, archive, pages, selected);
  console.log(`Retained ${retained.count} match pages and ${retained.urls} archive URLs.`);
  return { count: seen.size, sitemap: staticSitemap };
}

if (require.main === module) {
  const outputIndex = process.argv.indexOf('--output');
  const outputDir = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.join(root, '_site');
  generate(outputDir).catch((error) => {
    console.error(`[match-pages] ${error.message}`);
    process.exitCode = 1;
  });
}

function selectIndexableMatches(rows) {
  const preference = row => (/[\u0600-\u06ff]/.test(row.home_team + row.away_team) ? 4 : 0)
    + (String(row.source).startsWith('kooora') ? 8 : 0);
  const candidates = deduplicateSourceEvents(rows).filter(row => sourceMatchState(row.payload || {}) !== 'unavailable'
    && row.home_team && row.away_team && safeDate(row.kickoff_time || row.payload?.scheduledAt))
    .sort((a, b) => preference(b) - preference(a) || Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0));
  const selected = [];
  for (const row of candidates) if (!selected.some(candidate => sameFixture(candidate, row))) selected.push(row);
  return selected.sort((a, b) => Date.parse(a.kickoff_time) - Date.parse(b.kickoff_time));
}

function selectHomepageMatches(rows) {
  return rows.filter(row => (String(row.source).startsWith('kooora')
    || (row.source === 'api-football' && isGulfCupLeague(row.league))) && isAllowedMatch({
      league: row.league, leagueCountry: row.payload?.leagueCountry,
      homeTeam: row.home_team, awayTeam: row.away_team
    }));
}

module.exports = { escapeHtml, matchSlug, matchPage, generate, selectIndexableMatches, selectHomepageMatches };
