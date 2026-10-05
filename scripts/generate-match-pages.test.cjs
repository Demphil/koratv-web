const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { matchSlug, matchPage, generate, selectIndexableMatches, selectHomepageMatches } = require('./generate-match-pages.cjs');

const sample = {
  id: 'fixture-123',
  match_id: 'fixture-123',
  home_team: 'الرجاء <script>',
  away_team: 'الوداد',
  league: 'البطولة',
  kickoff_time: '2026-09-29T19:00:00Z',
  updated_at: '2026-09-29T18:00:00Z',
  payload: {
    score: '2 - 1',
    isFinished: true,
    goals: [{ player: 'لاعب', minute: 42 }],
    statistics: [{ statistics: [{ type: 'الاستحواذ', value: '55%' }] }]
  }
};

test('match detail path stays deterministic and includes unique fixture id', () => {
  assert.equal(matchSlug(sample), matchSlug(sample));
  assert.match(matchSlug(sample), /2026-09-29-/);
  assert.notEqual(matchSlug(sample), matchSlug({ ...sample, match_id: 'fixture-456' }));
});

test('bilingual fixtures share one indexable page while cancellations are excluded', async () => {
  const english = { ...sample, match_id: 'english', home_team: 'Morocco', away_team: 'Mali', source: 'api-football', payload: { status: 'NS' } };
  const arabic = { ...english, match_id: 'arabic', source: 'kooora', home_team: 'المغرب', away_team: 'مالي' };
  const cancelled = { ...english, match_id: 'cancelled', away_team: 'Ghana', payload: { status: 'CANC' } };
  const selected = selectIndexableMatches([english, cancelled, arabic]);
  assert.deepEqual(selected.map(row => row.match_id), ['arabic']);
  assert.deepEqual(selectIndexableMatches([{ ...english, source: 'kooora' }, { ...arabic, source: 'api-football' }]).map(row => row.match_id), ['english']);
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-alias-'));
  try {
    const result = await generate(output, [english, arabic, cancelled]);
    assert.equal(result.count, 1);
    const redirect = fs.readFileSync(path.join(output, 'match', matchSlug(english), 'index.html'), 'utf8');
    assert.match(redirect, /http-equiv="refresh" content="0;/);
    assert.ok(redirect.includes('/match/' + matchSlug(arabic) + '/'));
    const sitemap = fs.readFileSync(result.sitemap, 'utf8');
    assert.ok(!sitemap.includes(matchSlug(english)));
    assert.ok(!sitemap.includes(matchSlug(cancelled)));
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('authoritative live status overrides an outdated finished flag in detail pages', () => {
  const page = matchPage({ ...sample, payload: { status: '2H', isFinished: true, score: '0 - 0' } }, { siteUrl: 'https://koratv.click', brand: 'koratv' });
  assert.match(page.html, /مباراة جارية/);
  assert.doesNotMatch(page.html, /انتهت المباراة/);
});

test('homepage HTML uses the same Kooora-first source and league scope as the live feed', () => {
  const primary = { ...sample, match_id: 'primary', source: 'kooora', league: 'الدوري الإسباني', home_team: 'Barcelona', away_team: 'Real Madrid' };
  const hiddenApi = { ...primary, match_id: 'api', source: 'api-football' };
  const gulf = { ...hiddenApi, match_id: 'gulf', league: 'كأس الخليج', home_team: 'السعودية', away_team: 'قطر' };
  const excluded = { ...primary, match_id: 'excluded', league: 'الدوري الإنجليزي للسيدات', home_team: 'Chelsea Women' };
  assert.deepEqual(selectHomepageMatches([primary, hiddenApi, gulf, excluded]).map(row => row.match_id), ['primary', 'gulf']);
});

test('generated page exposes only supplied match facts and escapes text', () => {
  const page = matchPage(sample, { siteUrl: 'https://koratv.click', brand: 'KoraTV' });
  assert.ok(page);
  assert.match(page.html, /2 - 1/);
  assert.match(page.html, /الاستحواذ/);
  assert.match(page.html, /55%/);
  assert.match(page.html, /لاعب/);
  assert.doesNotMatch(page.html, /<script>\/script>/);
  assert.match(page.html, /canonical/);
  assert.match(page.html, /BreadcrumbList/);
});

test('rows without teams or a valid kickoff are not indexable', () => {
  assert.equal(matchPage({ ...sample, home_team: '' }, { siteUrl: 'https://koratv.click', brand: 'KoraTV' }), null);
  assert.equal(matchPage({ ...sample, kickoff_time: 'invalid' }, { siteUrl: 'https://koratv.click', brand: 'KoraTV' }), null);
});

test('static build writes detail pages and keeps core sitemap URLs', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'match-pages-'));
  try {
    fs.writeFileSync(path.join(output, 'sitemap.xml'), '<urlset><url><loc>https://koratv.click/</loc></url><url><loc>https://koratv.click/news.html</loc></url></urlset>');
    const result = await generate(output, [sample]);
    const pagePath = path.join(output, 'match', matchSlug(sample), 'index.html');
    const sitemap = fs.readFileSync(result.sitemap, 'utf8');
    assert.equal(result.count, 1);
    assert.ok(fs.existsSync(pagePath));
    assert.match(sitemap, /https:\/\/koratv\.click\//);
    assert.match(sitemap, /https:\/\/koratv\.click\/news\.html/);
    assert.match(sitemap, new RegExp(`/match/${matchSlug(sample)}/`));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
