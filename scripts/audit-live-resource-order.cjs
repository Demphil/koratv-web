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
    await page.evaluateOnNewDocument(()=>{
      window.__qaHlsErrors=[];
      window.__qaHlsProgress=[];
      window.__qaHlsTracks=[];
      setInterval(()=>{
        try {
          if(typeof hls==='undefined' || !hls || hls.__qaWatched) return;
          hls.__qaWatched=true;
          hls.on(Hls.Events.ERROR,(_,data)=>window.__qaHlsErrors.push({type:data.type,details:data.details,fatal:data.fatal,code:data.response?.code}));
          for(const name of [Hls.Events.FRAG_LOADED,Hls.Events.FRAG_PARSED,Hls.Events.BUFFER_APPENDED])
            hls.on(name,()=>window.__qaHlsProgress.push(name));
          for(const name of [Hls.Events.FRAG_PARSING_INIT_SEGMENT,Hls.Events.BUFFER_CODECS])
            hls.on(name,(_,data)=>window.__qaHlsTracks.push({name,tracks:Object.keys(data.tracks || data)}));
        } catch {}
      },100);
    });
    await page.setUserAgent(ua);
    await page.setViewport(viewport);
    await page.setRequestInterception(true);
    page.on('request',request=>{
      return adHosts.test(request.url()) ? request.abort() : request.continue();
    });
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
        playbackMatches=matches.filter(m=>m.playbackState==='live' && m.sourceReady && m.resourceStatus==='ASSIGNED'
          && (!process.env.QA_MATCH_FILTER || new RegExp(process.env.QA_MATCH_FILTER).test(m.matchId)));
        await page.close();
      }
    }
    const playbackFailures = [];
    for(const match of playbackMatches) {
      const page=await newPage({width:390,height:844});
      const mediaResponses = [];
      const codecLogs=[];
      page.on('console',message=>{
        const line=message.text();
        if(message.type()==='error' || /codec|demux|remux|buffer|transmux|worker/i.test(line)) codecLogs.push(line.replace(/https?:\/\/\S+/g,'[url]'));
      });
      page.on('requestfailed',request=>{
        const path=new URL(request.url()).pathname;
        if(path === '/api/resource' || path === '/api/stream.m3u8') mediaResponses.push({path,error:request.failure()?.errorText});
      });
      page.on('response', async response=> {
        const path = new URL(response.url()).pathname;
        if (path === '/api/stream.m3u8' || path === '/api/resource') {
          const row={path,status:response.status(),bytes:response.headers()['content-length'],contentType:response.headers()['content-type']};
          mediaResponses.push(row);
          if(path === '/api/resource' && response.status()===200) {
            try { const bytes=await response.buffer(); row.received=bytes.length;row.signature=bytes.subarray(0,8).toString('hex'); } catch {row.bodyFailed=true;}
          }
        }
      });
      await page.goto('https://fabor.sbs/739184.html?match='+publicMatchId(match.matchId),{waitUntil:'domcontentloaded'});
      await page.waitForFunction(id=>typeof currentMatchInfo!=='undefined' && currentMatchInfo?.matchId===id,{},match.matchId);
      await page.waitForSelector('button[data-plyr="play"]', {visible:true,timeout:30000});
      if (await page.$eval('video', v=>v.paused)) {
        const play = await page.$('.plyr__controls button[data-plyr="play"]');
        if (play) await play.click();
      }
      await page.bringToFront();
      await page.evaluate(()=>{ window.__qaPlayResult='pending'; video.play().then(()=>window.__qaPlayResult='playing')
        .catch(error=>window.__qaPlayResult=error.name); });
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
          hls:await page.evaluate(()=>({playResult:window.__qaPlayResult,errors:window.__qaHlsErrors,
            progress:window.__qaHlsProgress.slice(-12),
            tracks:window.__qaHlsTracks,
            mse:typeof hls==='undefined' ? null : {state:hls?.bufferController?.mediaSource?.readyState,
              attached:hls?.media===video,connected:video.isConnected,preload:video.preload,srcProtocol:video.src.split(':')[0],
              objectMatches:hls?.bufferController?._objectUrl===video.src,
              currentProtocol:video.currentSrc.split(':')[0],networkState:video.networkState},
            levels:typeof hls==='undefined' ? [] : hls?.levels.map(l=>({videoCodec:l.videoCodec,audioCodec:l.audioCodec,width:l.width,height:l.height}))})),
          codecLogs:codecLogs.slice(-40),
          state:await page.evaluate(()=>document.querySelector('.player-status')?.textContent || document.body.innerText.slice(0,800))}));
        playbackFailures.push(match.matchId);
      } finally {await page.close();}
    }
    assert.equal(playbackFailures.length, 0, 'Some prepared live streams did not play: '+playbackFailures.join(', '));
    if(!playbackMatches.length) console.log(JSON.stringify({playbackSkipped:'No assigned live fixture with a channel was available at inspection time'}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
