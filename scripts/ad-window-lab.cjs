const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const advertiser = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<!doctype html><title>Local advertiser fixture</title><h1>Local advertiser fixture</h1><p>No ad network, tracking or billable impression.</p>');
});
advertiser.listen(0, '127.0.0.1', () => {
  const ad = 'http://localhost:' + advertiser.address().port + '/advertiser';
  const publisher = http.createServer((req, res) => {
    const host = 'http://localhost:' + publisher.address().port;
    const url = new URL(req.url, host);
    const type = url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    if (url.pathname === '/monetag-window.js') return res.end(fs.readFileSync(path.join(root, 'assets/js/monetag-window.js')));
    if (url.pathname === '/network-fixture.js') return res.end(`
      document.getElementById('fixture-surface').addEventListener('click', () => {
        const frame = document.createElement('iframe'); frame.src='about:blank'; frame.hidden=true; document.body.appendChild(frame);
        const result=frame.contentWindow.open.call(window,${JSON.stringify(ad)},'_blank','');
        record('actual-open-return', {reference:Boolean(result)}); frame.remove();
        setTimeout(()=>record('after-open-500ms'),500);
      });
    `);
    if (url.pathname !== '/') return res.end('<h1>Local service fixture</h1>');
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Publisher ad-window safety lab</title>
      <style>body{font:16px system-ui;margin:32px;max-width:980px;color:#14352c;background:#eef3f0}label{display:block;margin:16px 0}input{padding:8px}#fixture-surface{background:#fff;border:1px solid #577d6b;padding:42px;cursor:pointer}pre{white-space:pre-wrap;font-size:13px}button,a{margin:8px}</style>
      <script>const rows=[];function record(event,detail={}){rows.push({event,focused:document.hasFocus(),visibility:document.visibilityState,...detail});document.getElementById('log').textContent=JSON.stringify(rows,null,2)}addEventListener('publisher-ad:diagnostic',e=>record(e.detail.event,e.detail));addEventListener('focus',()=>record('focus'));addEventListener('blur',()=>record('blur'));</script>
      <script src="/monetag-window.js" data-source="${host}/network-fixture.js" data-zones="0" data-desktop="chrome-windows" data-mobile-swap="${url.searchParams.get('mobile') === '1' ? 'android-chrome' : 'off'}" data-components="ui" data-diagnostic="1"></script>
      <h1>Publisher ad-window safety lab</h1><p>No production ads or playback services are loaded.</p>
      <label>Safe search <input id="query" value="Morocco football"></label>
      <label><input id="busy" type="checkbox">Operation in progress</label>
      <button id="control">Protected control</button><output id="control-result">Not used</output>
      <a href="/service" target="_blank" rel="noopener noreferrer">Unrelated service</a>
      <div id="fixture-surface">Open one local advertiser fixture through a temporary iframe</div>
      <pre id="log"></pre><script>
      document.getElementById('control').onclick=()=>document.getElementById('control-result').textContent='Control works';
      document.getElementById('busy').onchange=e=>document.body.dataset.adBusy=String(e.target.checked);
      PublisherAdWindow.register('ui',{capture:()=>({query:document.getElementById('query').value}),restore:s=>{if(typeof s?.query!=='string')return false;document.getElementById('query').value=s.query;return true}});
      record('ready',{ua:navigator.userAgent});
      </script><script src="/network-fixture.js" data-zone="0"></script></html>`);
  });
  publisher.listen(0, '127.0.0.1', () => console.log('AD_WINDOW_LAB=http://localhost:' + publisher.address().port + '/'));
  function close() { publisher.close(); advertiser.close(); }
  process.on('SIGINT', close); process.on('SIGTERM', close);
});
