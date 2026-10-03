const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

(async () => {
  const { publicMatchId } = await import('../shared/public-match-id.mjs');
  const browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const host of ['koratv.click', 'fraja.online']) {
      for (const width of [1366, 390]) {
        const page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.setViewport({ width, height: 900 });
        await page.setCacheEnabled(false);
        await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('a[data-secure-match-id]');
        const links = await page.$$eval('a[data-secure-match-id]', items => items.map(item => ({
          url: item.href, id: decodeURIComponent(item.dataset.secureMatchId),
        })));
        for (const link of links) assert.equal(new URL(link.url).searchParams.get('match'), publicMatchId(link.id));
        console.log(JSON.stringify({ host, width, numericLinks: links.length }));
        await page.close();
      }
    }
    const response = await fetch('https://stream-api.koratv.click/api/matches?day=today', {
      headers: { Origin: 'https://koratv.click' },
    });
    assert.equal(response.status, 200);
    const { matches } = await response.json();
    const match = matches.find(item => item.playbackState === 'live' && item.sourceReady) || matches[0];
    assert.ok(match);
    const id = publicMatchId(match.matchId);
    for (const [path, input] of [['/739184.html', id], ['/739184.html', match.matchId], ['/watch.html', id]]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setUserAgent(userAgent);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/.test(request.url()) ? request.abort() : request.continue());
      await page.goto(`https://fabor.sbs${path}?match=${encodeURIComponent(input)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(expected => typeof currentMatchInfo !== 'undefined' && currentMatchInfo?.matchId === expected,
        { timeout: 20000 }, match.matchId);
      const actual = await page.evaluate(() => ({ url: location.href, embed: embedSrc(), matchId: activeMatchId,
        home: currentMatchInfo.homeTeam, away: currentMatchInfo.awayTeam, channel: currentMatchInfo.channelName }));
      assert.equal(new URL(actual.url).searchParams.get('match'), id);
      assert.equal(new URL(actual.embed).searchParams.get('match'), id);
      assert.equal(actual.matchId, match.matchId);
      assert.equal(actual.home, match.homeTeam);
      assert.equal(actual.away, match.awayTeam);
      assert.deepEqual(errors, []);
      if (match.playbackState === 'live' && match.sourceReady) {
        await page.waitForFunction(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames > 0, { timeout: 30000 });
        actual.frames = await page.$eval('video', video => video.getVideoPlaybackQuality().totalVideoFrames);
      }
      console.log(JSON.stringify({ path, legacy: input !== id, ...actual }));
      await context.close();
    }
    const context = await browser.createBrowserContext();
    const parent = await context.newPage();
    await parent.setUserAgent(userAgent);
    await parent.setViewport({ width: 390, height: 844 });
    await parent.setRequestInterception(true);
    parent.on('request', request => /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com/.test(request.url()) ? request.abort() : request.continue());
    await parent.setContent(`<iframe src="https://fabor.sbs/watch.html?match=${id}" allow="autoplay; fullscreen" style="width:100%;height:500px"></iframe>`);
    const frame = await (await parent.$('iframe')).contentFrame();
    await frame.waitForFunction(expected => typeof currentMatchInfo !== 'undefined' && currentMatchInfo?.matchId === expected,
      { timeout: 20000 }, match.matchId);
    const framed = await frame.evaluate(() => ({ url: location.href, embedded: window.self !== window.top, matchId: activeMatchId }));
    assert.equal(framed.matchId, match.matchId);
    assert.equal(framed.embedded, true);
    assert.equal(new URL(framed.url).searchParams.get('match'), id);
    if (match.playbackState === 'live' && match.sourceReady) {
      await frame.waitForFunction(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames > 0, { timeout: 30000 });
      framed.frames = await frame.$eval('video', video => video.getVideoPlaybackQuality().totalVideoFrames);
    }
    console.log(JSON.stringify({ mobileIframe: framed }));
    await context.close();
    const missing = await fetch('https://stream-api.koratv.click/api/match-info?matchId=00000000000000000000', {
      headers: { Origin: 'https://fabor.sbs' },
    });
    assert.equal(missing.status, 404);
    console.log(JSON.stringify({ unknownNumericMatchStatus: missing.status }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
