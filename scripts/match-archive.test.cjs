const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('cheerio');
const { loadArchive, restoreSlugs, writeArchive, metadata, id, validateEntry, groupSlug } = require('./match-archive.cjs');
const { matchPage, matchSlug } = require('./generate-match-pages.cjs');
const config = { siteUrl: 'https://koratv.click', brand: 'KoraTV' };
const row = { match_id: 'example', home_team: 'المغرب', away_team: 'مالي', league: 'مباريات دولية', kickoff_time: '2026-10-02T18:00:00Z', updated_at: '2026-10-02T20:00:00Z', payload: { score: '2 - 1', isFinished: true, streamUrl: 'SECRET_PROVIDER', operatorPassword: 'SECRET_PASSWORD' } };
const fixture = () => ({ ...matchPage(row, config), identity: id(row) });
const empty = () => ({ version: 1, pages: [], aliases: [] });
function setup() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
  fs.writeFileSync(path.join(output, 'sitemap.xml'), `<urlset><url><loc>${config.siteUrl}/</loc></url></urlset>`);
  fs.writeFileSync(path.join(output, 'index.html'), '<html><body><footer></footer></body></html>');
  return output;
}
function persisted(output) {
  const catalog = JSON.parse(fs.readFileSync(path.join(output, 'archive/catalog.json')));
  return { ...catalog, pages: catalog.shards.flatMap(shard => JSON.parse(fs.readFileSync(path.join(output, 'archive/data', shard.file)))) };
}

test('published results survive a new build with an empty daily feed', () => {
  const first = setup();
  const second = setup();
  try {
    writeArchive(first, config, empty(), [fixture()], [row]);
    const data = persisted(first);
    assert.equal(data.pages.length, 1);
    writeArchive(second, config, data, [], []);
    const html = fs.readFileSync(path.join(second, 'match', matchSlug(row), 'index.html'), 'utf8');
    assert.match(html, /2 - 1/);
    assert.match(html, /أرشيف النتائج/);
    assert.doesNotMatch(JSON.stringify(data), /SECRET_PROVIDER|SECRET_PASSWORD|operatorPassword|streamUrl/);
    const sitemap = fs.readFileSync(path.join(second, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /\/archive\//);
    assert.match(sitemap, /\/competitions\//);
    assert.match(sitemap, /\/teams\//);
    assert.doesNotMatch(sitemap, /catalog\.json|SECRET/);
    assert.ok(!sitemap.includes(`/teams/${groupSlug(row.home_team)}/`));
    assert.match(fs.readFileSync(path.join(second, 'teams', groupSlug(row.home_team), 'index.html'), 'utf8'), /noindex,follow/);
    assert.equal(persisted(second).pages[0].lastmod, data.pages[0].lastmod);
  } finally { fs.rmSync(first, { recursive: true }); fs.rmSync(second, { recursive: true }); }
});

test('every archive navigation target exists and headings contain real team data', () => {
  const output = setup();
  try {
    writeArchive(output, config, empty(), [fixture()], [row]);
    for (const route of ['archive', 'archive/2026-10', 'teams', `teams/${groupSlug(row.home_team)}`, 'competitions', `competitions/${groupSlug(row.league)}`]) {
      const $ = load(fs.readFileSync(path.join(output, route, 'index.html'), 'utf8'));
      assert.equal($('h1').length, 1);
      for (const a of $('a[href^="/"]').toArray()) {
        const href = decodeURIComponent($(a).attr('href'));
        assert.ok(fs.existsSync(path.join(output, href, 'index.html')), href);
      }
    }
  } finally { fs.rmSync(output, { recursive: true }); }
});

test('same fixture keeps its published URL when team name is corrected', () => {
  const prior = metadata(fixture(), id(row));
  const [corrected] = restoreSlugs([{ ...row, home_team: 'Morocco' }], { pages: [prior] });
  assert.equal(matchSlug(corrected), prior.slug);
  assert.equal(matchPage(corrected, config).slug, prior.slug);
});

test('database timestamp alone does not change lastmod', () => {
  const output = setup();
  try {
    const original = fixture();
    writeArchive(output, config, { ...empty(), pages: [metadata(original, id(row))] }, [{ ...original, lastmod: '2026-10-10' }], [row]);
    assert.equal(persisted(output).pages[0].lastmod, original.lastmod);
  } finally { fs.rmSync(output, { recursive: true }); }
});

test('archive rejects traversal, mismatched canonicals and executable markup', () => {
  const page = metadata(fixture());
  assert.throws(() => validateEntry({ ...page, slug: '../private' }, config));
  assert.throws(() => validateEntry({ ...page, html: page.html.replace('https://koratv.click/match/', 'https://other.invalid/match/') }, config));
  assert.throws(() => validateEntry({ ...page, html: page.html + '<script>alert(1)</script>' }, config));
});

test('load fails closed on unavailable or malformed archive instead of replacing it', async t => {
  t.mock.method(global, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(loadArchive(config), /503/);
  global.fetch = async () => new Response('{"version":2,"shards":null}', { status: 200 });
  await assert.rejects(loadArchive(config), /Invalid archive/);
});

test('published sharded archive can be loaded and validated', async t => {
  const output = setup();
  try {
    writeArchive(output, config, empty(), [fixture()], [row]);
    t.mock.method(global, 'fetch', async url => new Response(fs.readFileSync(path.join(output, new URL(url).pathname)), { status: 200 }));
    const data = await loadArchive(config);
    assert.equal(data.pages.length, 1);
    assert.equal(data.pages[0].slug, matchSlug(row));
  } finally { fs.rmSync(output, { recursive: true }); }
});
