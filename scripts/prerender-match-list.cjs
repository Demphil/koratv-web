const { load } = require('cheerio');
const { sourceMatchState } = require('../shared/match-lifecycle.mjs');

function dateKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderScheduleCard(row, slug) {
  const payload = row.payload || {};
  const kickoff = row.kickoff_time || payload.scheduledAt;
  const time = new Intl.DateTimeFormat('ar-MA', {
    timeZone: 'Africa/Casablanca', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23'
  }).format(new Date(kickoff));
  const state = sourceMatchState(payload);
  const score = /^\d+\s*-\s*\d+$/.test(String(payload.score || '')) ? payload.score : '';
  return `<article class="prerendered-match" data-fixture-day="${dateKey(kickoff)}">
  <h3>${escapeHtml(row.home_team)} <span>ضد</span> ${escapeHtml(row.away_team)}</h3>
  <p>${escapeHtml(row.league || 'كرة القدم')}</p>
  <time datetime="${escapeHtml(new Date(kickoff).toISOString())}">${escapeHtml(time)} · توقيت المغرب</time>
  ${score ? `<p>${state === 'ended' ? 'النتيجة النهائية' : 'النتيجة عند تحديث الجدول'}: <b dir="ltr">${escapeHtml(score)}</b></p>` : ''}
  <a href="/match/${encodeURIComponent(slug)}/">نتيجة المباراة وإحصائياتها</a>
</article>`;
}

function prerenderHomepage(html, rows, matchSlug, now = new Date()) {
  const $ = load(html);
  const today = dateKey(now);
  const [year, month, day] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const groups = { today: [], tomorrow: [] };
  const phase = row => sourceMatchState(row.payload || {}) === 'live' ? 0
    : sourceMatchState(row.payload || {}) === 'ended' ? 2 : 1;
  const ordered = [...rows].sort((a, b) => phase(a) - phase(b)
    || (phase(a) === 0 ? -1 : 1) * (Date.parse(a.kickoff_time) - Date.parse(b.kickoff_time)));
  for (const row of ordered) {
    const key = dateKey(row.kickoff_time || row.payload?.scheduledAt);
    if (key === today) groups.today.push(renderScheduleCard(row, matchSlug(row)));
    else if (key === tomorrow) groups.tomorrow.push(renderScheduleCard(row, matchSlug(row)));
  }
  for (const [selector, cards] of [['#featured-matches', groups.today], ['#today-matches', groups.today], ['#tomorrow-matches', groups.tomorrow]]) {
    if (!cards.length || !$(selector).length) continue;
    $(selector).html(cards.join('\n')).attr('data-prerendered-day', today);
  }
  return $.html();
}

module.exports = { dateKey, prerenderHomepage, renderScheduleCard };
