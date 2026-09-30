import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBroadcasts, mergeRefreshedMatch, broadcastChannelCandidates, sameFixture, deduplicateSourceEvents, obsoleteMatchRows } from '../../shared/match-broadcasts.mjs';
import { extractKoooraBroadcastChannelsFromHtml, parseKoooraMatches, persistMatchSnapshots } from '../scripts/sync-matches-from-source.js';
import { findChannelNameMatch } from '../../shared/channel-name-match.mjs';
import { matchChannels, parseM3uText } from '../scripts/import-m3u.js';
import { liveCatalogToM3u } from '../scripts/sync-iptv-provider.js';
import { enrichMatchChannels } from '../scripts/enrich-match-language-channels.js';
import { resolveBroadcastChannelsWithGemini, resolveBroadcastChannelsBatchWithGemini } from '../src/lib/geminiChannelResolver.js';

const kickoff_time = '2026-09-27T13:00:00Z';
const api = { match_id: 'api-1', source: 'api-football', home_team: 'Lithuania', away_team: 'Azerbaijan',
  kickoff_time, channel: null, payload: { sourceFixtureId: 1528895, score: '1 - 1', lineups: [{ team: 'Lithuania' }] } };
const kooora = { match_id: 'kooora-1', source: 'kooora', home_team: 'ليتوانيا', away_team: 'أذربيجان',
  kickoff_time, payload: { sourceMatchId: 'event-1', channels: ['beIN Sports Mena 2', 'CBC Sport'] } };
const checkedAt = '2026-09-27T14:00:00Z';

test('Gemini is disabled and unverified legacy assignments cannot open a stream', async () => {
  assert.equal((await enrichMatchChannels()).disabled, true);
  await assert.rejects(resolveBroadcastChannelsWithGemini(api), /disabled/);
  await assert.rejects(resolveBroadcastChannelsBatchWithGemini([api]), /disabled/);
  assert.deepEqual(broadcastChannelCandidates({ channel: 'beIN SPORTS HD 4', payload: { channelResolvedBy: 'gemini' } }), []);
  assert.deepEqual(broadcastChannelCandidates({ channel: 'beIN SPORTS HD 4', source: 'api-football' }), []);
});

test('retention expires 24-hour data and removes only replaced same-source fixtures', () => {
  const now = Date.parse(checkedAt);
  const [fresh] = reconcileBroadcasts([{ ...kooora, updated_at: checkedAt }], { checkedAt });
  const legacy = { ...kooora, match_id: 'legacy', updated_at: '2026-09-27T13:00:00Z' };
  const apiCopy = { ...api, updated_at: checkedAt };
  const other = { ...legacy, match_id: 'other', away_team: 'Albania' };
  const expired = { ...legacy, match_id: 'expired', kickoff_time: '2026-09-26T13:59:59Z' };
  const stale = { ...legacy, match_id: 'stale', kickoff_time: '2026-09-28T13:00:00Z', updated_at: '2026-09-26T13:59:59Z' };
  const manual = { ...expired, match_id: 'manual', source: 'manual' };
  assert.deepEqual(obsoleteMatchRows([fresh, legacy, apiCopy, other, expired, stale, manual], [fresh], now)
    .map(row => row.match_id), ['legacy', 'expired', 'stale']);
  const newer = { ...legacy, updated_at: '2026-09-27T14:01:00Z' };
  assert.deepEqual(obsoleteMatchRows([newer], [fresh], now), []);
  const equal = { ...fresh, match_id: 'z-duplicate' };
  assert.equal(obsoleteMatchRows([fresh, equal], [fresh, equal], now).length, 1);
});

test('live provider catalog validates inventory without opening scarce playback connections', () => {
  const endpoint = new URL('https://provider.example/get.php?username=user&password=pass');
  const text = liveCatalogToM3u([{ name: 'AR | BEIN SPORTS 02 HD', stream_id: 42 }], endpoint);
  const [match] = matchChannels(['beIN SPORTS HD 2'], parseM3uText(text));
  assert.equal(match.original_url, 'https://provider.example/live/user/pass/42.m3u8');
  assert.throws(() => liveCatalogToM3u({ error: 'denied' }, endpoint));
  assert.throws(() => liveCatalogToM3u([], endpoint));
});

test('joins exact bilingual opponents and kickoff, preserving API-Football details', () => {
  const rows = reconcileBroadcasts([api, kooora], { checkedAt });
  assert.equal(rows[0].channel, 'beIN SPORTS HD 2');
  assert.deepEqual(rows[0].payload.lineups, api.payload.lineups);
  assert.equal(rows[0].payload.sourceFixtureId, 1528895);
  assert.equal(rows[0].payload.broadcast.sourceMatchId, 'event-1');
  assert.equal(rows[1].channel, rows[0].channel);
});

test('Arabic broadcasters are tried before foreign options while preserving their source order', () => {
  const row = reconcileBroadcasts([{ ...kooora, payload: { ...kooora.payload,
    channels: ['SuperSport Maximo 1', 'beIN Sports Mena 2', 'SABC Plus', 'Arryadia TNT'] } }], { checkedAt })[0];
  assert.deepEqual(broadcastChannelCandidates(row), ['beIN SPORTS HD 2', 'Arryadia TNT', 'SuperSport Maximo 1', 'SABC Plus']);
});

test('team badge alt text is never stored as a broadcaster', () => {
  const [row] = reconcileBroadcasts([{ ...kooora, payload: { ...kooora.payload,
    channels: ['إيريتريا badge', 'Abu Dhabi Sports 2', 'MBC Action'] } }], { checkedAt });
  assert.equal(row.channel, 'Abu Dhabi Sports 2');
  assert.deepEqual(row.payload.broadcast.channels, ['Abu Dhabi Sports 2', 'MBC Action']);
  assert.deepEqual(broadcastChannelCandidates(row), ['Abu Dhabi Sports 2', 'MBC Action']);
});

test('joins St. Vincent API naming to Kooora Arabic naming only for the same kickoff', () => {
  const apiMatch = { ...api, home_team: 'St. Vincent / Grenadines', away_team: 'Belize' };
  const koooraMatch = { ...kooora, home_team: 'سانت فنسنت وجزر غرينادين', away_team: 'بليز' };
  const [row] = reconcileBroadcasts([apiMatch, koooraMatch], { checkedAt });
  assert.equal(row.channel, 'beIN SPORTS HD 2');
  assert.equal(row.payload.broadcast.sourceMatchId, 'event-1');
  const [wrongTime] = reconcileBroadcasts([apiMatch, { ...koooraMatch, kickoff_time: '2026-09-27T13:16:00Z' }], { checkedAt });
  assert.equal(wrongTime.channel, null);
});

test('different opponent, day, category, youth and Botafogo PB never borrow channels', () => {
  for (const changed of [
    { away_team: 'Albania' }, { kickoff_time: '2026-09-28T13:00:00Z' },
    { league: 'UEFA Nations League Women' }, { home_team: 'Lithuania U19' },
  ]) assert.equal(sameFixture({ ...api, ...changed }, kooora), false);
  assert.equal(sameFixture({ ...api, home_team: 'Botafogo PB' }, { ...api, home_team: 'Botafogo' }), false);
});

test('reversed source display order does not replace the API home and away teams', () => {
  const reversed = { ...kooora, home_team: kooora.away_team, away_team: kooora.home_team };
  const [row] = reconcileBroadcasts([api, reversed], { checkedAt });
  assert.equal(row.channel, 'beIN SPORTS HD 2');
  assert.equal(row.home_team, 'Lithuania');
});

test('ambiguous source events fail closed instead of guessing', () => {
  const duplicate = { ...kooora, payload: { ...kooora.payload, sourceMatchId: 'different-event' } };
  const [row] = reconcileBroadcasts([api, kooora, duplicate], { checkedAt });
  assert.equal(row.channel, null);
  assert.equal(row.payload.broadcast.state, 'ambiguous_fixture');
});

test('fresh assignments replace stale channels and fresh empty list clears stale data', () => {
  const [fresh] = reconcileBroadcasts([api, kooora], { checkedAt });
  const existing = { ...api, channel: 'Arryadia TNT', payload: { channel: 'Arryadia TNT', events: [{ type: 'Goal' }] } };
  const merged = mergeRefreshedMatch(existing, fresh);
  assert.equal(merged.channel, 'beIN SPORTS HD 2');
  assert.equal(merged.payload.channel, merged.channel);
  assert.equal(merged.payload.events.length, 1);
  const [empty] = reconcileBroadcasts([api, { ...kooora, payload: { ...kooora.payload, channels: [] } }], { checkedAt });
  const cleared = mergeRefreshedMatch(merged, empty);
  assert.equal(cleared.channel, null);
  assert.deepEqual(broadcastChannelCandidates(cleared), []);
});

test('source outage preserves only recent verified assignments, not legacy league guesses', () => {
  const [verified] = reconcileBroadcasts([api, kooora], { checkedAt });
  const [unavailable] = reconcileBroadcasts([api], { checkedAt, failedDates: ['2026-09-27'] });
  const now = Date.parse(checkedAt) + 60_000;
  assert.equal(mergeRefreshedMatch(verified, unavailable, now).channel, 'beIN SPORTS HD 2');
  assert.equal(mergeRefreshedMatch(verified, unavailable, now + 7 * 60 * 60_000).channel, null);
  assert.equal(mergeRefreshedMatch({ channel: 'Arryadia TNT' }, unavailable, now).channel, null);
});

test('exact channel wins over duplicate aliases; MAX numbers remain distinct', () => {
  assert.equal(findChannelNameMatch('beIN SPORTS HD 2', ['Bein Sports HD2', 'beIN SPORTS HD 2']), 'beIN SPORTS HD 2');
  assert.equal(findChannelNameMatch('beIN Sports Mena 2', ['beIN SPORTS HD 2']), 'beIN SPORTS HD 2');
  assert.equal(findChannelNameMatch('beIN SPORTS MAX 1', ['beIN SPORTS MAX 2']), null);
  assert.equal(findChannelNameMatch('beIN Sports ENG 2', ['beIN SPORTS HD 2']), null);
});

test('new source event replaces legacy copy, regardless of legacy channel readiness', () => {
  const old = { ...kooora, source: 'kooora-today-matches', match_id: 'legacy', updated_at: '2026-09-27T13:00:00Z' };
  const current = { ...kooora, updated_at: checkedAt };
  assert.deepEqual(deduplicateSourceEvents([old, current]), [current]);
});

test('snapshot writes compare the read version and skip a newer concurrent update', async () => {
  const seen = [];
  const client = { from() { return {
    update(row) { seen.push(row); return this; },
    eq(key, value) { seen.push([key, value]); return this; },
    async select() { return { data: [], error: null }; },
  }; } };
  const row = { ...api, updated_at: checkedAt };
  assert.equal(await persistMatchSnapshots(client, [row], new Map([[api.match_id, '2026-09-27T13:59:00Z']])), 0);
  assert.deepEqual(seen.at(-1), ['updated_at', '2026-09-27T13:59:00Z']);
  seen.length = 0;
  assert.equal(await persistMatchSnapshots(client, [row], new Map([[api.match_id, '2026-09-27T14:01:00Z']])), 0);
  assert.equal(seen.length, 0);
});

test('provider candidates never substitute channel 12, MAX 2 or a French feed for MENA 2', () => {
  const names = ['AR | beIN SPORTS HD 12', 'AR | beIN SPORTS MAX 2', 'FR | beIN SPORTS HD 2', 'AR | beIN SPORTS HD 2'];
  const entries = parseM3uText('#EXTM3U\n' + names.map((name, i) => `#EXTINF:-1,${name}\nhttps://example.test/${i}.m3u8`).join('\n'));
  const [match] = matchChannels(['beIN SPORTS HD 2'], entries, { candidatesPerChannel: 8 });
  assert.deepEqual(match.candidates.map((item) => item.original_url), ['https://example.test/3.m3u8']);
});

test('Kooora scraper prefers real broadcaster names from watch cards over generic platforms', () => {
  const html = `<!doctype html><html><body>
    <section data-match-id="fixture-1" class="match-card">
      <div class="watch-provider">
        <span>شاهد مباشرة على</span>
        <img alt="Abu Dhabi Sports 2 logo">
        <strong>Abu Dhabi Sports 2</strong>
      </div>
      <div class="watch-provider" data-broadcaster="MBC Action">شاهد مباشرة على MBC Action</div>
      <div class="watch-provider">شاهد مباشرة على fuboTV</div>
    </section>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { data: [{
        competition: { name: 'دوري أبطال أوروبا' },
        matches: [{
          id: 'fixture-1',
          startDate: '2026-09-30T20:00:00.000Z',
          status: 'FIXTURE',
          teamA: { name: 'Real Madrid', image: {} },
          teamB: { name: 'Barcelona', image: {} },
          score: {},
          link: { slug: 'real-madrid-v-barcelona' },
          tvChannels: [{ name: 'fuboTV' }, { name: 'Disney+' }]
        }]
      }] } }
    })}</script>
  </body></html>`;
  const [row] = parseKoooraMatches(html);
  assert.equal(row.channel, 'Abu Dhabi Sports 2');
  assert.deepEqual(row.payload.channels, ['Abu Dhabi Sports 2', 'MBC Action']);
});

test('Kooora match detail extractor reads visible watch-on broadcaster cards', () => {
  const html = `<!doctype html><html><body>
    <div class="competition-watch">
      <div class="provider-card" data-provider-name="MBC Action">شاهد مباشرة على MBC Action</div>
      <div class="provider-card">شاهد مباشرة على Disney+</div>
    </div>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { data: { tvChannels: [{ name: 'Disney+' }] } } }
    })}</script>
  </body></html>`;
  assert.deepEqual(extractKoooraBroadcastChannelsFromHtml(html), ['MBC Action']);
});
