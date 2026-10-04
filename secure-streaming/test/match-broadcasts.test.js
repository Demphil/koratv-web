import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBroadcasts, mergeRefreshedMatch, broadcastChannelCandidates, sameFixture, deduplicateSourceEvents, obsoleteMatchRows } from '../../shared/match-broadcasts.mjs';
import { extractKoooraBroadcastChannelsFromHtml, parseKoooraMatches, parseKoooraScheduleBroadcasts, persistMatchSnapshots, koooraDetailChannelTargets } from '../scripts/sync-matches-from-source.js';
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

test('international friendly refresh retires cancelled Morocco fixture and retains valid Morocco and live Argentina', () => {
  const matches = [
    { id: 'morocco-mali', teamA: { name: 'المغرب' }, teamB: { name: 'مالي' }, status: 'FIXTURE' },
    { id: 'morocco-ghana', teamA: { name: 'المغرب' }, teamB: { name: 'غانا' }, status: 'CANCELLED' },
    { id: 'argentina', teamA: { name: 'الأرجنتين' }, teamB: { name: 'بوركينا فاسو' }, status: 'LIVE' },
  ].map(match => ({ ...match, startDate: kickoff_time }));
  const html = '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { data: [
    { competition: { name: 'المباريات الودية' }, matches }
  ] } } }) + '</script>';
  const rows = parseKoooraMatches(html);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter(row => row.active).map(row => row.payload.sourceMatchId), ['morocco-mali', 'argentina']);
  const cancelled = rows.find(row => row.payload.sourceMatchId === 'morocco-ghana');
  const existing = { ...cancelled, active: true, payload: { status: 'FIXTURE' } };
  const refreshed = mergeRefreshedMatch(existing, cancelled);
  assert.equal(refreshed.active, false);
  assert.equal(refreshed.payload.status, 'CANCELLED');
  assert.equal(rows.find(row => row.payload.sourceMatchId === 'argentina').payload.isLive, true);
});

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
    .map(row => row.match_id), ['expired', 'stale']);
  const tomorrowFresh = { ...fresh, match_id: 'tomorrow-fresh', kickoff_time: '2026-09-28T13:00:00Z' };
  const tomorrowLegacy = { ...tomorrowFresh, match_id: 'tomorrow-legacy', updated_at: '2026-09-27T13:00:00Z' };
  assert.deepEqual(obsoleteMatchRows([tomorrowLegacy], [tomorrowFresh], now).map(row => row.match_id), ['tomorrow-legacy']);
  const newer = { ...legacy, updated_at: '2026-09-27T14:01:00Z' };
  assert.deepEqual(obsoleteMatchRows([newer], [fresh], now), []);
  const equal = { ...tomorrowFresh, match_id: 'z-duplicate' };
  assert.equal(obsoleteMatchRows([tomorrowFresh, equal], [tomorrowFresh, equal], now).length, 1);
});

test('retention keeps finished same-day fixtures until Morocco midnight', () => {
  const now = Date.parse('2026-09-27T22:30:00Z');
  const todayFinished = {
    ...kooora,
    match_id: 'today-finished',
    kickoff_time: '2026-09-27T13:00:00Z',
    updated_at: '2026-09-26T20:00:00Z',
    payload: { ...kooora.payload, isFinished: true }
  };
  const replacement = {
    ...todayFinished,
    match_id: 'today-replacement',
    updated_at: '2026-09-27T22:00:00Z',
    payload: { ...todayFinished.payload, broadcast: { source: 'kooora' } }
  };
  const yesterdayFinished = {
    ...todayFinished,
    match_id: 'yesterday-finished',
    kickoff_time: '2026-09-26T13:00:00Z'
  };

  assert.deepEqual(obsoleteMatchRows([todayFinished], [replacement], now), []);
  assert.deepEqual(obsoleteMatchRows([yesterdayFinished], [], now).map(row => row.match_id), ['yesterday-finished']);
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

test('fresh assignments replace stale channels and temporary empty Kooora data preserves recent channels', () => {
  const [fresh] = reconcileBroadcasts([api, kooora], { checkedAt });
  const existing = { ...api, channel: 'Arryadia TNT', payload: { channel: 'Arryadia TNT', events: [{ type: 'Goal' }] } };
  const merged = mergeRefreshedMatch(existing, fresh);
  assert.equal(merged.channel, 'beIN SPORTS HD 2');
  assert.equal(merged.payload.channel, merged.channel);
  assert.equal(merged.payload.events.length, 1);
  const [empty] = reconcileBroadcasts([api, { ...kooora, payload: { ...kooora.payload, channels: [] } }], { checkedAt });
  const cleared = mergeRefreshedMatch(merged, empty, Date.parse(checkedAt) + 60_000);
  assert.equal(cleared.channel, 'beIN SPORTS HD 2');
  assert.equal(cleared.payload.broadcast.stale, true);
  const expired = mergeRefreshedMatch(merged, empty, Date.parse(checkedAt) + 25 * 60 * 60_000);
  assert.equal(expired.channel, null);
  assert.deepEqual(broadcastChannelCandidates(expired), []);
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
  assert.equal(row.payload.matchLink, 'https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D8%A8%D8%A7%D8%B1%D8%A7%D8%A9/real-madrid-v-barcelona/fixture-1');
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

test('Kooora channel extraction never borrows another fixture watch card or team badge', () => {
  const html = `<body>
    <section data-match-id="other" class="match-card"><div class="watch-provider" data-broadcaster="beIN Sports Mena 2"></div></section>
    <img alt="Spain badge"><img alt="Czechia badge">
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: [{
      competition: { name: 'La Liga' }, matches: [{ id: 'target', startDate: kickoff_time, status: 'LIVE',
        teamA: { name: 'Real Madrid' }, teamB: { name: 'Barcelona' }, tvChannels: [], score: {} }]
    }] } } })}</script></body>`;
  const [row] = parseKoooraMatches(html);
  assert.deepEqual(row.payload.channels, []);
  assert.equal(row.channel, null);
  assert.deepEqual(extractKoooraBroadcastChannelsFromHtml(html, 'target'), []);
});

test('Kooora detail channels require the requested exact source fixture ID', () => {
  const html = `<body><div class="watch-provider" data-broadcaster="AL KASS One"></div>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: {
      match: { id: 'target' }, tvChannels: [{ name: 'AL KASS One' }]
    } } } })}</script></body>`;
  assert.deepEqual(extractKoooraBroadcastChannelsFromHtml(html, 'target'), ['AL KASS One']);
  assert.deepEqual(extractKoooraBroadcastChannelsFromHtml(html, 'different'), []);
});

test('Kooora period is authoritative for live minute and stoppage time', () => {
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { data: [{
    competition: { name: 'La Liga' }, matches: [{ id: 'clock', startDate: kickoff_time, status: 'LIVE',
      teamA: { name: 'Real Madrid' }, teamB: { name: 'Barcelona' }, score: { teamA: 1, teamB: 0 },
      period: { type: 'SECOND_HALF', minute: 90, extra: 3 } }]
  }] } } })}</script>`;
  const [row] = parseKoooraMatches(html);
  assert.equal(row.payload.liveMinute, 90);
  assert.equal(row.payload.liveExtraMinute, 3);
  assert.equal(row.payload.score, '1 - 0');
});

test('detail channel lookup budget goes to live and upcoming fixtures, not finished rows at the top of the source', () => {
  const row = (id, status, time) => ({ match_id: id, source: 'kooora', kickoff_time: time,
    payload: { status, channels: [], matchLink: `https://www.kooora.com/${id}` } });
  const rows = [row('ended', 'RESULT', kickoff_time), row('later', 'FIXTURE', '2026-09-27T19:00:00Z'),
    row('live', 'LIVE', '2026-09-27T17:00:00Z'), row('next', 'FIXTURE', '2026-09-27T18:00:00Z')];
  assert.deepEqual(koooraDetailChannelTargets(rows, 2).map(row => row.match_id), ['live', 'next']);
});

test('fresh Kooora lifecycle clears a previously stored finished flag', () => {
  for (const status of ['FIXTURE', 'LIVE', 'RESULT']) {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { data: [{ competition: { name: 'La Liga' }, matches: [{
        id: 'lifecycle-fixture', startDate: kickoff_time, status,
        teamA: { name: 'Real Madrid' }, teamB: { name: 'Barcelona' }, score: {}
      }] }] } }
    })}</script>`;
    const [fresh] = parseKoooraMatches(html);
    const merged = mergeRefreshedMatch({ ...fresh, payload: { ...fresh.payload, isFinished: true } }, fresh);
    assert.equal(merged.payload.isFinished, status === 'RESULT');
    assert.equal(merged.payload.isLive, status === 'LIVE');
  }
});

test('Kooora TV schedule parser extracts event broadcaster schedules', () => {
  const html = `<!doctype html><html><body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { data: { scheduleGroups: [{
        competition: { name: 'كأس الخليج' },
        events: [{
          name: 'البحرين ضد اليمن',
          startDate: kickoff_time,
          link: { id: 'event-1', url: 'https://www.kooora.com/كرة-القدم/مباراة/البحرين-ضد-اليمن/event-1' },
          schedule: [{ name: 'Abu Dhabi Sports 2' }, { name: 'Disney+' }, { name: 'Kuwait Sports' }]
        }]
      }] } } }
    })}</script>
  </body></html>`;
  const [row] = parseKoooraScheduleBroadcasts(html);
  assert.equal(row.home_team, 'البحرين');
  assert.equal(row.away_team, 'اليمن');
  assert.deepEqual(row.payload.channels, ['Abu Dhabi Sports 2', 'Kuwait Sports']);
});
