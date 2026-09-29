const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { matchSlug, matchPage, generate } = require('./generate-match-pages.cjs');

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
