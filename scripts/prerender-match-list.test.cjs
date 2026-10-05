const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { prerenderHomepage, dateKey } = require('./prerender-match-list.cjs');

const markup = '<!doctype html><html><head><title>koratv</title></head><body><div id="featured-matches"><div id="loading">Loading</div></div><div id="today-matches"></div><div id="tomorrow-matches" style="display:none"></div><script type="module" src="/assets/js/matches.js"></script></body></html>';
const fixture = {
  home_team: 'مصر', away_team: 'جنوب أفريقيا', kickoff_time: '2026-10-05T18:00:00Z',
  league: 'مباراة ودية', channel: 'On Sport Plus', payload: { status: 'NS' }
};

test('initial HTML includes real visible match facts and crawlable links without JavaScript', () => {
  const html = prerenderHomepage(markup, [fixture], () => 'fixture-1', new Date('2026-10-05T10:00:00Z'));
  const $ = load(html);
  assert.match($('#featured-matches').text(), /مصر/);
  assert.match($('#featured-matches').text(), /On Sport Plus/);
  assert.equal($('#today-matches a').attr('href'), '/match/fixture-1/');
  assert.equal($('#loading').length, 0);
  assert.equal($('script[type=module]').attr('src'), '/assets/js/matches.js');
  assert.equal($('#featured-matches').attr('data-prerendered-day'), '2026-10-05');
});

test('prerendering filters calendar days in Morocco, including midnight and DST', () => {
  assert.equal(dateKey('2026-10-04T23:00:00Z'), '2026-10-05');
  for (const now of ['2026-10-04T22:59:59Z', '2026-03-22T22:30:00Z']) {
    const next = { ...fixture, kickoff_time: new Date(new Date(now).getTime() + 2 * 3600000).toISOString() };
    const html = prerenderHomepage(markup, [next], () => 'next', new Date(now));
    assert.equal(load(html)('#tomorrow-matches a').length, 1);
    assert.equal(load(html)('#today-matches a').length, 0);
  }
});

test('no stale live label, guessed ending, HTML injection, or private payload is rendered', () => {
  const row = { ...fixture, home_team: '<script>alert(1)</script>', channel: '<img onerror="x">',
    payload: { status: '2H', isFinished: true, score: '2 - 0', providerUrl: 'SECRET_PROVIDER_URL' } };
  const html = prerenderHomepage(markup, [row], () => 'safe', new Date('2026-10-05T10:00:00Z'));
  assert.doesNotMatch(html, /SECRET_PROVIDER_URL|النتيجة النهائية|<script>alert|<img onerror/);
  assert.match(html, /النتيجة عند تحديث الجدول/);
  assert.match(html, /&lt;script&gt;/);
});

test('empty daily snapshot keeps the ordinary loading state without fabricated matches', () => {
  const html = prerenderHomepage(markup, [], () => 'none', new Date('2026-10-05T10:00:00Z'));
  assert.equal(load(html)('#loading').length, 1);
  assert.equal(load(html)('.prerendered-match').length, 0);
});
