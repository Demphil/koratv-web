const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const adHosts = /omg10\.com|nap5k\.com|n6wxm\.com|al5sm\.com|quge5\.com|profitablerate/;

(async () => {
  const {frontendMatchState} = await import('../shared/match-lifecycle.mjs');
  const {publicMatchId} = await import('../shared/public-match-id.mjs');
  const source = readFileSync(require.resolve('../assets/js/matches.js'),'utf8');
  const block = source.slice(source.indexOf('function compareBroadcastPriority('), source.indexOf('function renderMatchCollections('));
  const compare = vm.runInNewContext(block+';compareBroadcastPriority', {frontendMatchState, matchStartDate: match=>new Date(match.scheduledAt)});
  const browser = await puppeteer.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const newPage = async viewport => {
    const page = await browser.newPage();
    await page.setUserAgent(ua);
    await page.setViewport(viewport);
    await page.setRequestInterception(true);
    page.on('request',request=>adHosts.test(request.url()) ? request.abort() : request.continue());
    return page;
  };
  let playbackMatches = [];
  try {
    for (const origin of ['https://koratv.click','https://fraja.online']) {
      for (const viewport of [{width:1366,height:900},{width:390,height:844}]) {
        const page = await newPage(viewport);
        await page.goto(origin,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>Array.from(document.scripts).some(s=>s.src.includes('20261004-live-order'))
          && document.querySelector('.match-card[data-match-id]'),{timeout:30000});
        const {matches} = await page.evaluate(async()=>await (await fetch('https://stream-api.koratv.click/api/matches?day=today')).json());
        const ids = await page.evaluate(()=>{
          const container=document.getElementById('featured-matches') || document.getElementById('today-matches');
          return Array.from(container.querySelectorAll('.match-card[data-match-id]')).map(card=>card.dataset.matchId);
        });
        const byId=new Map(matches.map(m=>[m.matchId,m]));
        const displayed=ids.map(id=>byId.get(id)).filter(Boolean);
        assert.equal(displayed.length, ids.length);
        assert.ok(displayed.length > 1, 'Verify the whole ordered collection, not a single card');
        const now=new Date();
        for(let i=1;i<displayed.length;i++) assert.ok(compare(displayed[i-1],displayed[i],now)<=0,'Frontend order differs from live-first ordering');
        assert.equal(matches.some(m=>m.playbackState==='ended' && m.resourceStatus==='ASSIGNED'),false);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
        assert.equal(overflow,false);
        console.log(JSON.stringify({origin,viewport:viewport.width,orderVerified:true,first:displayed.slice(0,4).map(m=>({id:m.matchId,status:m.status,resource:m.resourceStatus,ready:m.sourceReady})),endedWorkers:0}));
        playbackMatches=matches.filter(m=>m.playbackState==='live' && m.sourceReady && m.resourceStatus==='ASSIGNED');
        await page.close();
      }
    }
    for(const match of playbackMatches) {
      const page=await newPage({width:390,height:844});
      await page.goto('https://fabor.sbs/739184.html?match='+publicMatchId(match.matchId),{waitUntil:'domcontentloaded'});
      await page.waitForFunction(id=>typeof currentMatchInfo!=='undefined' && currentMatchInfo?.matchId===id,{},match.matchId);
      try {
        await page.waitForFunction(()=>document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames>0,{timeout:30000});
        console.log(JSON.stringify({player:match.matchId,decodedVideoFrames:await page.$eval('video',v=>v.getVideoPlaybackQuality().totalVideoFrames)}));
      } catch(error) {
        console.log(JSON.stringify({player:match.matchId,decodedVideoFrames:0,state:await page.evaluate(()=>document.querySelector('.player-status')?.textContent || document.body.innerText.slice(0,800))}));
        throw error;
      } finally {await page.close();}
    }
    if(!playbackMatches.length) console.log(JSON.stringify({playbackSkipped:'No assigned live fixture with a channel was available at inspection time'}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
