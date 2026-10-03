const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '../streaming-gateway/dist');
const output = path.join(root, 'qa-match-ui');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const fakeHls = `class Hls {
  static isSupported(){return true;} static Events={ERROR:'error',MANIFEST_PARSED:'manifest',FRAG_LOADED:'frag'};
  static ErrorDetails={BUFFER_STALLED_ERROR:'stall'}; static ErrorTypes={NETWORK_ERROR:'network',MEDIA_ERROR:'media'};
  constructor(){this.handlers={};this.levels=[{height:720}];window.testHls=this;}
  on(event,handler){this.handlers[event]=handler;} loadSource(){} destroy(){} startLoad(){} recoverMediaError(){}
  attachMedia(video){setTimeout(()=>{this.handlers.manifest?.();video.dispatchEvent(new Event('canplay'));},20);}
}`;
(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`);
    if (!file.startsWith(root + path.sep)) return res.writeHead(400).end();
    try {
      const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const width of [1366, 390, 320]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setUserAgent(ua);
      await page.setViewport({ width, height: 900 });
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
      const errors = [], tags = [];
      page.on('pageerror', error => errors.push(error.message));
      const grids = ['1:1','2:1','2:2','2:3','2:4','3:1','3:2','3:3','3:4','4:1','4:2'];
      const match = { matchId:'fixture-match', homeTeam:'السعودية', awayTeam:'قطر', homeTeamId:1, awayTeamId:2,
        homeLogo:`${base}/flag-morocco.png`, awayLogo:`${base}/flag-morocco.png`, score:'0 - 0', liveMinute:94,
        playbackState:'live', sourceReady:true, resourceStatus:'ASSIGNED', channelName:'Al KASS One', league:'كأس الخليج',
        referee:'حكم المباراة', venue:'مدينة الملك عبدالله الرياضية', yellowCards:{home:1,away:2},
        events:[{elapsed:66,type:'subst',player:'لاعب 6',assist:'بديل 1',team:'السعودية'}], eventDetailsLoaded:true,
        lineups:[1,2].map(id=>({team:id===1?'السعودية':'قطر',teamId:id,formation:'4-4-2',coach:'مدرب الفريق',
          startXI:grids.map((grid,i)=>({name:`لاعب ${i+1}`,number:i+1,grid,rating:6.5})),
          substitutes:[1,2,3,4,5,6].map(i=>({name:`بديل ${i}`,number:11+i}))})),
        statistics:['السعودية','قطر'].map((team,i)=>({team,statistics:[
          {type:'Ball Possession',value:i?'39%':'61%'},{type:'Total Shots',value:i?2:12},
          {type:'Shots on Goal',value:i?0:5},{type:'Shots insidebox',value:i?0:5},{type:'Passes accurate',value:i?320:532}]})) };
      await page.evaluateOnNewDocument(() => {
        window.open = (...args) => { (window.testPopups ||= []).push(args); return null; };
        const now = performance.now.bind(performance);
        performance.now = () => now() + (window.adClockOffset || 0);
        HTMLMediaElement.prototype.play = function () {
          Object.defineProperty(this,'paused',{configurable:true,get:()=>this.dataset.playing!=='1'});
          this.dataset.playing='1'; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function () { this.dataset.playing='0';this.dispatchEvent(new Event('pause')); };
      });
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/config.js') return request.respond({contentType:'text/javascript',body:`const STREAM_API_ORIGIN=${JSON.stringify(base)};const STREAM_API_ORIGINS=new Set([STREAM_API_ORIGIN]);`});
        if (url.pathname === '/hls.min.js') return request.respond({contentType:'text/javascript',body:fakeHls});
        if (url.pathname === '/api/match-info') return request.respond({contentType:'application/json',body:JSON.stringify({match})});
        if (url.pathname === '/api/redeem-token') return request.respond({contentType:'application/json',body:JSON.stringify({token:'fixture-session',expiresIn:3600,channelName:match.channelName})});
        if (url.pathname.startsWith('/api/')) return request.respond({contentType:'application/json',body:'{"ok":true,"items":[]}'});
        if (['nap5k.com','n6wxm.com'].includes(url.hostname)) {tags.push(url.href);return request.respond({contentType:'text/javascript',body:''});}
        if (url.origin === base) return request.continue();
        return request.respond({contentType:'application/json',body:'{"items":[],"articles":[]}'});
      });
      const ticket = `a.${Buffer.from(JSON.stringify({matchId:match.matchId})).toString('base64url')}.c`;
      await page.goto(`${base}/watch.html?k=${ticket}`);
      await page.waitForSelector('.plyr__controls');
      await page.waitForFunction(()=>document.querySelector('#status').textContent.trim()==='');
      assert.equal(tags.length,0,'no provider SDK before playback');
      await page.click('.plyr__control--overlaid');
      await page.waitForFunction(()=>document.querySelector('video').paused===false);
      await page.waitForFunction(()=>document.querySelectorAll('script[data-koratv-monetag]').length>0);
      assert.equal(await page.evaluate(()=>window.testPopups.length),1);
      assert.equal(tags.length,width>620?2:1);
      await page.evaluate(()=>{video.pause();});
      await page.click('.plyr__controls [data-plyr="play"]');
      assert.equal(await page.evaluate(()=>window.testPopups.length),1,'five-minute cap');
      await page.evaluate(()=>{window.adClockOffset=300001;video.pause();});
      await page.click('.plyr__controls [data-plyr="play"]');
      assert.equal(await page.evaluate(()=>window.testPopups.length),2);
      assert.equal(tags.length,width>620?2:1,'no duplicate SDK on resume');
      assert.equal(await page.$('select'),null);
      assert.equal(await page.$('[data-plyr="settings"]'),null);
      assert.equal(await page.$('.ad-click-shield'),null);
      for (const tab of ['details','lineups','standings']) {
        await page.click(`[data-endpoint="${tab}"]`);
        if (tab==='details') {
          assert.match(await page.$eval('.match-possession',el=>el.textContent),/61%/);
          assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.match-stat-row')].find(row=>row.textContent.includes('التسديدات على المرمى')).lastElementChild.textContent),'0');
        }
        if (tab==='lineups') {
          assert.equal((await page.$$('.lineup-positioned')).length,11);
          assert.equal((await page.$$('.bench-player')).length,6);
          await page.click('[data-lineup-side="away"]');
          assert.equal(await page.$eval('[data-lineup-side="away"]',el=>el.getAttribute('aria-pressed')),'true');
          assert.equal(await page.evaluate(()=>{const pitch=document.querySelector('.lineup-pitch').getBoundingClientRect();return [...document.querySelectorAll('.lineup-positioned')].every(el=>{const r=el.getBoundingClientRect();return r.left>=pitch.left&&r.right<=pitch.right&&r.top>=pitch.top&&r.bottom<=pitch.bottom;});}),true);
        }
        if (tab==='standings') {
          assert.match(await page.$eval('#match-api-detail',el=>el.textContent),/لم تصل بيانات أدوار خروج المغلوب/);
          await page.evaluate(() => {
            currentMatchInfo.knockout={rounds:[{key:'semifinal',name:'نصف النهائي',matches:[{fixtureId:'1',homeTeam:'السعودية',awayTeam:'قطر',score:'0 - 0'},{fixtureId:'2',homeTeam:'الإمارات',awayTeam:'عمان',score:'VS'}]},{key:'final',name:'النهائي',matches:[]}]};
            renderMatchPanel();
          });
          assert.equal((await page.$$('.final-four .bracket-fixture')).length,3);
          assert.match(await page.$eval('.bracket-pending',el=>el.textContent),/لم يتحدد بعد/);
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.$eval('#match-panel',el=>el.scrollIntoView({block:'start'}));
        await page.screenshot({path:path.join(output,`${tab}-${width}.png`)});
      }
      assert.equal(await page.$eval('.player-contact a',el=>el.textContent),'tvkora201@gmail.com');
      assert.deepEqual(errors,[]);
      await context.close();
      console.log(`Play ads, cooldown, all match tabs, portraits and layout passed at ${width}px`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
