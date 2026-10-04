const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

(async () => {
  const { publicMatchId } = await import('../shared/public-match-id.mjs');
  let argentinaForPlayer;
  for (const origin of ['https://koratv.click', 'https://fraja.online']) {
    const response = await fetch('https://stream-api.koratv.click/api/matches?day=today', { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    const { matches } = await response.json();
    const morocco = matches.filter(match => match.homeTeam === 'المغرب' || match.awayTeam === 'المغرب');
    assert.equal(morocco.length, 1);
    const mali = morocco[0];
    assert.ok([mali.homeTeam, mali.awayTeam].includes('مالي'));
    const argentina = matches.find(match => [match.homeTeam, match.awayTeam].includes('الأرجنتين')
      && [match.homeTeam, match.awayTeam].includes('بوركينا فاسو'));
    assert.ok(argentina);
    argentinaForPlayer = argentina;
    assert.equal(matches.some(match => /CANCELLED|CANCELED|CANC|PST/.test(match.status)), false);
    for (const match of [mali, argentina]) {
      const result = await fetch('https://stream-api.koratv.click/api/match-info?matchId=' + publicMatchId(match.matchId),
        { headers: { Origin: origin } });
      assert.equal(result.status, 200);
      const { match: detail } = await result.json();
      assert.equal(detail.matchId, match.matchId);
      assert.equal(detail.homeTeam, match.homeTeam);
      assert.equal(detail.awayTeam, match.awayTeam);
      console.log(JSON.stringify({ origin, matchId: detail.matchId, status: detail.status,
        home: detail.homeTeam, away: detail.awayTeam, channel: detail.channelName,
        sourceReady: detail.sourceReady, scheduledAt: detail.scheduledAt }));
    }
  }
  const browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const origin of ['https://koratv.click', 'https://fraja.online']) {
      const page = await browser.newPage();
      await page.setUserAgent(ua);
      await page.setViewport({ width: 390, height: 844 });
      await page.setRequestInterception(true);
      page.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com|quge5\.com|profitablerate/.test(request.url())
        ? request.abort() : request.continue());
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.match-card[data-match-id*="_المغرب_vs_مالي"]')
        && document.querySelector('.match-card[data-match-id*="_الارجنتين_vs_بوركينا_فاسو"]'));
      const cancelled = await page.$('.match-card[data-match-id*="_المغرب_vs_غانا"]');
      assert.equal(cancelled, null);
      console.log(JSON.stringify({ origin, mobileCards: 'Morocco-Mali and Argentina-Burkina Faso', cancelledMoroccoAbsent: true }));
      await page.close();
    }
    const player = await browser.newPage();
    await player.setUserAgent(ua);
    await player.setViewport({ width: 390, height: 844 });
    await player.setRequestInterception(true);
    player.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/.test(request.url())
      ? request.abort() : request.continue());
    await player.goto('https://fabor.sbs/739184.html?match=' + publicMatchId(argentinaForPlayer.matchId),
      { waitUntil: 'domcontentloaded' });
    await player.waitForFunction(expected => typeof currentMatchInfo !== 'undefined'
      && currentMatchInfo?.matchId === expected, {}, argentinaForPlayer.matchId);
    if (argentinaForPlayer.status === 'LIVE' && argentinaForPlayer.sourceReady) {
      await player.waitForFunction(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames > 0,
        { timeout: 30000 });
      const frames = await player.$eval('video', video => video.getVideoPlaybackQuality().totalVideoFrames);
      console.log(JSON.stringify({ argentinaPlayer: true, decodedVideoFrames: frames }));
    } else console.log(JSON.stringify({ argentinaPlayer: true, playbackSkipped: 'Fixture no longer live or source not prepared' }));
    await player.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
