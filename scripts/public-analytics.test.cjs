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

test('the published homepage uses this site account measurement ID', () => {
  const origin = fs.readFileSync(path.join(__dirname, '../CNAME'), 'utf8').trim();
  const expected = origin === 'fraja.online' ? 'G-7FCFB7ZN4G' : 'G-HKXWEPJ14K';
  assert.equal(measurementIdFromHomepage(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')), expected);
});
