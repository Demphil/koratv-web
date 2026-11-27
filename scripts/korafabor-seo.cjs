const { SELECTED_BROADCAST_IDS } = require('../shared/broadcast-selection.mjs');
const { publicMatchId } = require('../shared/public-match-id.mjs');
const { matchSlug } = require('./generate-match-pages.cjs');

const HOME_TITLE = 'بث مباشر مباريات اليوم | كورة فابور KoraFabor';
const HOME_HEADING = 'كورة فابور | بث مباشر مباريات اليوم';
const HOME_DESCRIPTION = 'شاهد البث المباشر للمباريات المختارة على كورة فابور KoraFabor، وتابع جدول مباريات اليوم والقنوات الناقلة والمواعيد والنتائج بتوقيت المغرب.';
const selected = new Map();
for (const id of SELECTED_BROADCAST_IDS) {
  const parts = id.match(/^kooora_(\d{4}-\d{2}-\d{2})_(.+)_vs_(.+)$/u);
  if (!parts) continue;
  const row = { match_id: id, home_team: parts[2].replaceAll('_', ' '), away_team: parts[3].replaceAll('_', ' '), kickoff_time: parts[1] + 'T12:00:00Z' };
  selected.set(`match/${matchSlug(row)}/index.html`, { ...row, day: parts[1] });
}

function setMetadata($, title, description) {
  if (!$('title').length) $('head').append('<title></title>');
  $('title').text(title);
  for (const [attribute, key, value] of [
    ['name', 'description', description], ['property', 'og:title', title], ['property', 'og:description', description],
    ['name', 'twitter:title', title], ['name', 'twitter:description', description]
  ]) {
    const selector = `meta[${attribute}="${key}"]`;
    if (!$(selector).length) $('head').append($('<meta>').attr(attribute, key));
    $(selector).attr('content', value);
  }
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const schema = JSON.parse($(element).text());
    for (const node of schema['@graph'] || [schema]) {
      if (node['@type'] === 'WebPage') { node.name = title; node.description = description; }
      if (node['@type'] === 'WebSite') node.description = HOME_DESCRIPTION;
    }
    $(element).text(JSON.stringify(schema).replace(/</g, '\\u003c'));
  }
}

function applyKoraFaborSeo($, { route, now = new Date() }) {
  $('meta[name="keywords"]').remove();
  if (route === 'index.html') {
    setMetadata($, HOME_TITLE, HOME_DESCRIPTION);
    $('.header-title').text(HOME_HEADING);
    $('.header .nav a[href="/"],.header .nav a[href="index.html"]').text('مباريات اليوم بث مباشر');
    const heading = $('.featured-section .section-title');
    if (heading.length) {
      const icon = heading.children('i').first().clone();
      heading.empty().append(icon).append(' مباريات اليوم بث مباشر');
    }
    return;
  }
  const match = selected.get(route);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!match || match.day !== day || !$('.match-detail').length) return;
  const state = $('.match-detail > .meta').first().text();
  if (/انتهت|ملغاة|مؤجلة/.test(state)) return;
  const teams = $('.match-detail h1').text().replace(/^بث مباشر مباراة\s*/, '').trim();
  if (!teams) return;
  if (/مباراة جارية/.test(state)) {
    setMetadata($, `بث مباشر مباراة ${teams} | كورة فابور`, `مشاهدة البث المباشر لمباراة ${teams} على كورة فابور، مع النتيجة الحالية وموعد اللقاء والقنوات الناقلة المتاحة بتوقيت المغرب.`);
    $('.match-detail h1').text(`بث مباشر مباراة ${teams}`);
    $('.korafabor-watch-link').remove();
    const link = $('<a>').addClass('match-detail-back korafabor-watch-link')
      .attr('href', `https://fabor.sbs/739184.html?match=${publicMatchId(match.match_id)}`).text('مشاهدة البث المباشر');
    $('.match-detail .scoreline').first().after(link);
  } else if (/موعد المباراة/.test(state)) {
    setMetadata($, `موعد بث مباراة ${teams} والقنوات الناقلة | كورة فابور`, `موعد مباراة ${teams} بتوقيت المغرب والقنوات الناقلة، مع متابعة البث المباشر عند توفره والنتيجة وتفاصيل اللقاء على كورة فابور.`);
  }
}

module.exports = { HOME_TITLE, HOME_HEADING, HOME_DESCRIPTION, applyKoraFaborSeo };
