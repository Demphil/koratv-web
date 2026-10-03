const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

(async () => {
  const { publicMatchId } = await import('../shared/public-match-id.mjs');
  let playerUrl;
  for (const origin of ['https://koratv.click', 'https://fraja.online']) {
    const response = await fetch('https://stream-api.koratv.click/api/matches?day=today', { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    const { matches } = await response.json();
    const selected = matches.filter(row => /الرجاء|النادي المكناسي|الدفاع الحسني|حسنية أغادير/.test(row.homeTeam));
    assert.ok(selected.length);
    for (const row of selected) {
      const id = publicMatchId(row.matchId);
      const result = await fetch(`https://stream-api.koratv.click/api/match-info?matchId=${id}`, { headers: { Origin: origin } });
      assert.equal(result.status, 200);
      const { match } = await result.json();
      assert.equal(match.matchId, row.matchId);
      assert.ok(Number.isSafeInteger(Number(match.sourceFixtureId)) && Number(match.sourceFixtureId) > 0);
      assert.ok(match.events.length > 0);
      assert.notEqual(match.detailsState, 'unmatched_fixture');
      console.log(JSON.stringify({ origin, matchId: match.matchId, fixtureId: match.sourceFixtureId,
        events: match.events.length,
        statistics: match.statistics.reduce((count, team) => count + team.statistics.filter(stat => stat.value != null).length, 0),
        lineups: match.lineups.filter(team => team.startXI?.length).length,
        state: match.detailsState, features: match.detailStates, channel: match.channelName }));
      if (/الرجاء/.test(row.homeTeam)) playerUrl = `https://fabor.sbs/739184.html?match=${id}`;
    }
  }
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const width of [1366, 390]) {
      const page = await browser.newPage();
      await page.setUserAgent(ua);
      await page.setViewport({ width, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/.test(request.url()) ? request.abort() : request.continue());
      await page.goto(playerUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof currentMatchInfo !== 'undefined' && currentMatchInfo?.events?.length > 0);
      const data = await page.evaluate(() => {
        document.querySelector('.match-api-node[data-endpoint="details"]').click();
        const events = document.querySelectorAll('.match-event').length;
        document.querySelector('.match-api-node[data-endpoint="lineups"]').click();
        return { events, lineupMessage: document.querySelector('.empty-match-data')?.textContent,
          fixtureId: currentMatchInfo.sourceFixtureId, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(data.events > 0);
      assert.equal(data.overflow, false);
      assert.equal(Number(data.fixtureId), 1640792);
      console.log(JSON.stringify({ playerWidth: width, ...data }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
