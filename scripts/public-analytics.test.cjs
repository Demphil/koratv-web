const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('cheerio');
const { measurementIdFromHomepage, instrumentPage, instrumentPublicPages } = require('./public-analytics.cjs');
const { validateEntry, metadata } = require('./match-archive.cjs');
const { matchPage } = require('./generate-match-pages.cjs');
const id = 'G-ABC1234567';
const page = '<html><head><link rel="canonical" href="https://example.test/"></head><body>Result</body></html>';

test('destination is read from the existing tag, not another property or arbitrary script', () => {
  assert.equal(measurementIdFromHomepage('<script src="https://www.googletagmanager.com/gtag/js?id=' + id + '"></script>'), id);
  assert.throws(() => measurementIdFromHomepage('<script src="https://untrusted.test/gtag/js?id=' + id + '"></script>'));
  assert.throws(() => instrumentPage(page, 'invalid'));
  assert.throws(() => instrumentPage('<link rel="canonical" href="/"><script src="https://www.googletagmanager.com/gtag/js?id=G-OTHER12345"></script>', id), /mismatch/);
});

test('fresh pages initialize once, tagged pages keep their existing initialization', () => {
  const fresh = instrumentPage(page, id);
  const $ = load(fresh);
  assert.equal($('script[data-site-metrics]').length, 1);
  assert.equal($('script[data-site-metrics]').attr('data-bootstrap'), 'true');
  assert.equal($('script[src*="googletagmanager"]').length, 1);
  assert.equal(instrumentPage(fresh, id), fresh);
  const existing = page.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + id + '"></script><script>gtag("config","' + id + '");</script></head>');
  const tagged = load(instrumentPage(existing, id));
  assert.equal(tagged('script[data-site-metrics]').attr('data-bootstrap'), 'false');
  assert.equal(tagged('script[src*="googletagmanager"]').length, 1);
});

test('public instrumentation leaves archive source and redirects untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-metrics-'));
  try {
    for (const dir of ['match/example', 'archive/data']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    const source = matchPage({ match_id: 'example', home_team: 'Home', away_team: 'Away', kickoff_time: '2026-10-18T18:00:00Z', payload: {} }, { siteUrl: 'https://example.test', brand: 'Example' });
    const catalog = JSON.stringify({ pages: [metadata(source)] });
    fs.writeFileSync(path.join(root, 'match/example/index.html'), source.html);
    fs.writeFileSync(path.join(root, 'archive/data/source.json'), catalog);
    instrumentPublicPages(root, id);
    assert.match(fs.readFileSync(path.join(root, 'match/example/index.html'), 'utf8'), /data-site-metrics/);
    assert.equal(fs.readFileSync(path.join(root, 'archive/data/source.json'), 'utf8'), catalog);
    assert.ok(validateEntry(metadata(source), { siteUrl: 'https://example.test' }));
    const redirect = '<meta http-equiv="refresh" content="0;url=/"><link rel="canonical" href="/">';
    assert.equal(instrumentPage(redirect, id), redirect);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function runtime(bootstrap = false, fail = false) {
  const calls = [], listeners = {};
  const window = bootstrap ? {} : { gtag: (...args) => { if (fail) throw new Error('blocked'); calls.push(args); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/site-metrics.js'), 'utf8'), {
    window, URL, Date, location: { origin: 'https://example.test', href: 'https://example.test/' },
    document: { currentScript: { dataset: { measurementId: id, bootstrap: String(bootstrap) } },
      addEventListener: (name, handler) => { listeners[name] = handler; } }
  });
  const click = (href, extra = {}, dataset = {}) => listeners[extra.type || 'click']({
    defaultPrevented: false, type: 'click', button: 0,
    target: { closest: () => ({ href, dataset }) }, ...extra
  });
  return { calls, window, click };
}

test('outbound intent does not leak token/query data or break navigation', () => {
  const r = runtime();
  r.click('https://fabor.sbs/739184.html?match=12345678901234567890&token=PRIVATE');
  assert.equal(r.calls[0][1], 'match_open');
  assert.equal(r.calls[0][2].match_id, '12345678901234567890');
  assert.doesNotMatch(JSON.stringify(r.calls), /PRIVATE|token|https:/);
  r.click('https://fabor.sbs/739184.html?match=invalid');
  r.click('https://other.test/739184.html?match=12345678901234567890');
  r.click('https://fabor.sbs/739184.html?match=12345678901234567890', { defaultPrevented: true });
  r.click('https://fabor.sbs/739184.html?match=12345678901234567890', {}, { disabledReason: 'upcoming' });
  assert.equal(r.calls.length, 1);
  assert.doesNotThrow(() => runtime(false, true).click('https://example.test/match/example/'));
});

test('detail navigation and middle clicks are measured without replacing existing gtag', () => {
  const r = runtime();
  r.click('https://example.test/match/example/');
  r.click('https://fabor.sbs/739184.html?match=12345678901234567890', { type: 'auxclick', button: 1 });
  r.click('https://fabor.sbs/739184.html?match=12345678901234567890', { type: 'auxclick', button: 2 });
  assert.deepEqual(r.calls.map(args => args[1]), ['result_open', 'match_open']);
  const fresh = runtime(true);
  assert.deepEqual(Array.from(fresh.window.dataLayer, args => args[0]), ['js', 'config']);
});

function assertAnalyticsDestination(html) {
  const measurementId = measurementIdFromHomepage(html);
  const $ = load(html);
  const bootstraps = $('script:not([src])').toArray().map(element => $(element).html() || '')
    .filter(source => source.includes('dataLayer') && /\bgtag\s*\(/.test(source));
  assert.equal(bootstraps.length, 1, 'one Analytics bootstrap is required');
  const context = { dataLayer: [] }; context.window = context;
  vm.runInNewContext(bootstraps[0], context, { timeout: 100 });
  const configured = Array.from(context.dataLayer, args => Array.from(args))
    .filter(args => args[0] === 'config').map(args => args[1]);
  assert.deepEqual(configured, [measurementId], 'the loader and inline config must use the same destination');
  const published = load(instrumentPage(html, measurementId));
  assert.equal(published('script[data-site-metrics]').attr('data-measurement-id'), measurementId);
  return measurementId;
}

test('the published homepage preserves its current Analytics destination consistently', () => {
  assertAnalyticsDestination(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
});

test('an intentional destination change is valid, but a stale inline config still fails', () => {
  const tagged = destination => page.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + destination
    + '"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag("config","' + destination + '");</script></head>');
  assert.equal(assertAnalyticsDestination(tagged('G-ROTATED123')), 'G-ROTATED123');
  assert.throws(() => assertAnalyticsDestination(tagged(id).replace('gtag("config","' + id, 'gtag("config","G-STALE12345')), /same destination/);
});
