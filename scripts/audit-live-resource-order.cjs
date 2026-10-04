const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
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
    const playbackFailures = [];
    for(const match of playbackMatches) {
      const page=await newPage({width:390,height:844});
      const mediaResponses = [];
      page.on('response', response=> {
        const path = new URL(response.url()).pathname;
        if (path === '/api/stream.m3u8' || path === '/api/resource') mediaResponses.push({path,status:response.status(),
          bytes:response.headers()['content-length'],contentType:response.headers()['content-type']});
      });
      await page.goto('https://fabor.sbs/739184.html?match='+publicMatchId(match.matchId),{waitUntil:'domcontentloaded'});
      await page.waitForFunction(id=>typeof currentMatchInfo!=='undefined' && currentMatchInfo?.matchId===id,{},match.matchId);
      await page.waitForSelector('button[data-plyr="play"]', {visible:true,timeout:30000});
      await page.evaluate(()=>{
        window.__qaHlsErrors=[];
        if (typeof hls !== 'undefined' && hls) hls.on(Hls.Events.ERROR,(_,data)=>{
          window.__qaHlsErrors.push({type:data.type,details:data.details,fatal:data.fatal,code:data.response?.code});
        });
      });
      if (await page.$eval('video', v=>v.paused)) {
        const play = await page.$('.plyr__controls button[data-plyr="play"]');
        if (play) await play.click();
      }
      try {
        await page.waitForFunction(()=>document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames>0,{timeout:30000});
        const firstFrames = await page.$eval('video',v=>v.getVideoPlaybackQuality().totalVideoFrames);
        await new Promise(resolve=>setTimeout(resolve,10000));
        const frames = await page.$eval('video',v=>v.getVideoPlaybackQuality().totalVideoFrames);
        assert.ok(frames > firstFrames, 'Video must keep advancing after the first decoded frame');
        const screenshot = join(tmpdir(), `koratv-live-${publicMatchId(match.matchId)}.png`);
        await page.screenshot({path:screenshot,fullPage:false});
        console.log(JSON.stringify({player:match.matchId,decodedVideoFrames:frames,advancing:true,screenshot}));
      } catch(error) {
        console.log(JSON.stringify({player:match.matchId,decodedVideoFrames:0,
          video:await page.$eval('video',v=>({paused:v.paused,time:v.currentTime,readyState:v.readyState,
            buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)]),error:v.error?.code})),
          mediaResponses:mediaResponses.slice(-12),
          hls:await page.evaluate(()=>({errors:window.__qaHlsErrors,
            levels:typeof hls==='undefined' ? [] : hls?.levels.map(l=>({videoCodec:l.videoCodec,audioCodec:l.audioCodec,width:l.width,height:l.height}))})),
          state:await page.evaluate(()=>document.querySelector('.player-status')?.textContent || document.body.innerText.slice(0,800))}));
        playbackFailures.push(match.matchId);
      } finally {await page.close();}
    }
    assert.equal(playbackFailures.length, 0, 'Some prepared live streams did not play: '+playbackFailures.join(', '));
    if(!playbackMatches.length) console.log(JSON.stringify({playbackSkipped:'No assigned live fixture with a channel was available at inspection time'}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
