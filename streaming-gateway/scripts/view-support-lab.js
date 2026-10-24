import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'cheerio';

const dist = resolve('dist');
const files = new Set(['player.css', 'plyr.css', 'plyr.js', 'plyr.svg', 'match-ui.css', 'view-support.css',
  'view-support.js', 'view-support-state.js', 'ads/prebid-ads.js', 'icons/tv.svg', 'icons/shield-alert.svg', 'icons/refresh-cw.svg']);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const blocked = url.searchParams.has('blocked') ? url.searchParams.get('blocked') === '1' : (req.headers.cookie || '').includes('supportlab=blocked');
  const networkOnly = url.searchParams.has('network') ? url.searchParams.get('network') === '1' : (req.headers.cookie || '').includes('supportlabNetwork=1');
  const cookie = ['supportlab=' + (blocked ? 'blocked' : 'allowed') + '; Path=/; SameSite=Lax',
    'supportlabNetwork=' + Number(networkOnly) + '; Path=/; SameSite=Lax'];
  if (url.pathname === '/mode') { res.writeHead(200, { 'Set-Cookie': cookie, 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url.pathname === '/embedded') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie });
    return res.end('<!doctype html><title>Embedded support notice lab</title><style>body{margin:0;background:#211d29;color:white;font:16px Tahoma}iframe{display:block;width:100%;height:360px;border:0}h1{font-size:18px;padding:12px}</style><h1>Embedded local playback test</h1><iframe src="/?embedded=1&blocked=' + Number(blocked) + '&network=' + Number(networkOnly) + '" allow="autoplay; fullscreen"></iframe>');
  }
  if (url.pathname.startsWith('/lab-sdk/')) {
    res.writeHead(networkOnly && blocked ? 403 : 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    return res.end('// Local non-advertising SDK fixture.');
  }
  const filename = url.pathname.slice(1);
  if (files.has(filename)) {
    if (filename === 'ads/prebid-ads.js' && blocked && !networkOnly) { res.writeHead(403, { 'Content-Type': 'text/javascript' }); return res.end(''); }
    const data = readFileSync(join(dist, filename));
    const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'image/svg+xml';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': data.length });
    return res.end(req.method === 'HEAD' ? undefined : data);
  }
  if (url.pathname !== '/') { res.writeHead(404); return res.end(); }
  const $ = load(readFileSync(join(dist, '739184.html'), 'utf8'));
  const origin = 'http://localhost:' + server.address().port;
  const providerCode = $('script:not([src])').last().html()
    .replaceAll('https://nap5k.com/tag.min.js', origin + '/lab-sdk/primary.js')
    .replaceAll('https://n6wxm.com/vignette.min.js', origin + '/lab-sdk/vignette.js')
    .replaceAll('https://al5sm.com/tag.min.js', origin + '/lab-sdk/onclick.js')
    .replaceAll('https://omg10.com/4/11949902', origin + '/lab-ad-destination');
  $('script').remove();
  $('link[rel="stylesheet"]').each((_, node) => { if (!files.has($(node).attr('href').replace('./', '').split('?')[0])) $(node).remove(); });
  $('img').each((_, node) => { if (!files.has(($(node).attr('src') || '').replace('./', ''))) $(node).remove(); });
  $('#status,.player-contact,.watch-news-section,#page-depth,#embed-button,#refresh-stream,#video-picture-overlay').remove();
  if (url.searchParams.has('embedded')) $('html').addClass('embedded-view');
  $('head').append('<style>html.embedded-view #lab-tools{display:none!important}</style><style id="lab-blocker">' + (blocked && !networkOnly ? '.adsbox{display:none!important}' : '') + '</style>');
  $('body').prepend('<nav id="lab-tools" style="display:flex;gap:12px;flex-wrap:wrap;padding:10px;color:white;font:14px Tahoma"><strong>Local video test, no ads or streaming API</strong><button id="lab-toggle">' + (blocked ? 'Allow local probe' : 'Block local probe') + '</button><button id="lab-fullscreen">Fullscreen test</button><output id="lab-metrics"></output></nav>');
  $('body').append(`<script src="./plyr.js"></script><script>
    const video=document.getElementById('video');video.muted=true;video.autoplay=true;
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
    function frame(){const t=performance.now();ctx.fillStyle='#184c39';ctx.fillRect(0,0,960,540);ctx.fillStyle='#1c5842';for(let x=0;x<960;x+=160)ctx.fillRect(x,0,80,540);ctx.strokeStyle='#bfd9ca';ctx.lineWidth=3;ctx.strokeRect(35,30,890,480);ctx.beginPath();ctx.arc(480,270,80,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(480,30);ctx.lineTo(480,510);ctx.stroke();ctx.fillStyle='white';ctx.beginPath();ctx.arc(150+(t/8)%650,270,12,0,Math.PI*2);ctx.fill();ctx.font='28px Arial';ctx.fillText('LOCAL TEST VIDEO',350,72)}setInterval(frame,100);frame();
    new Plyr(video,{iconUrl:'./plyr.svg',muted:true,autoplay:true,storage:{enabled:false},controls:['play','progress','current-time','mute','volume','fullscreen']});
    video.muted=true;video.srcObject=canvas.captureStream(10);video.play().catch(console.error);
    let blocked=${JSON.stringify(blocked)};
    document.getElementById('lab-toggle').onclick=async()=>{blocked=!blocked;await fetch('/mode?blocked='+Number(blocked));document.getElementById('lab-blocker').textContent=blocked&&!${JSON.stringify(networkOnly)}?'.adsbox{display:none!important}':'';document.getElementById('lab-toggle').textContent=blocked?'Allow local probe':'Block local probe'};
    document.getElementById('lab-fullscreen').onclick=()=>video.closest('.plyr').requestFullscreen();
    setInterval(()=>{document.getElementById('lab-metrics').textContent='time='+video.currentTime.toFixed(1)+' frames='+video.getVideoPlaybackQuality().totalVideoFrames+' paused='+video.paused+' notice='+!document.getElementById('watch-support-panel').hidden},500);
  </script><script>${providerCode}</script><script type="module" src="./view-support.js"></script>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookie,
    'Content-Security-Policy': "default-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'" });
  res.end($.html());
});
server.listen(0, '127.0.0.1', () => console.log('VIEW_SUPPORT_LAB=http://localhost:' + server.address().port + '/?blocked=1&network=1'));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
