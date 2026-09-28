const summary = document.querySelector('#summary');
const toggle = document.querySelector('#toggle');
const access = location.hash.slice(1) || sessionStorage.getItem('multiview-access');
if (location.hash) { sessionStorage.setItem('multiview-access', access); history.replaceState(null, '', location.pathname); }
const screens = [];
let running = true;
let polling = false;
const api = async (path, method = 'GET') => {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${access}` }, cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 ? 'رابط الاختبار غير صالح أو انتهت صلاحيته' : `HTTP ${response.status}`);
  return response.json();
};
function state(screen, value, ok = false) { screen.state.textContent = value; screen.state.dataset.ok = String(ok); }
async function start() {
  if (!access) throw new Error('افتح رابط الاختبار الخاص المزوّد بمفتاح الدخول');
  const result = await api('/api/multiview/session', 'POST');
  for (const item of result.screens) {
    const root = document.querySelector('#screen-template').content.firstElementChild.cloneNode(true);
    document.querySelector('#screens').append(root);
    root.querySelector('h2').textContent = item.channel;
    const screen = { ...item, root, video: root.querySelector('video'), state: root.querySelector('.state'), loaded: 0, lastSn: null, lastFrame: 0, movedAt: 0, retryAt: 0 };
    screens.push(screen);
    if (item.error) { state(screen, 'القناة غير موجودة في الكتالوج'); continue; }
    if (Hls.isSupported()) {
      const hls = screen.hls = new Hls({ lowLatencyMode: false, maxBufferLength: 30, maxMaxBufferLength: 60, liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 10 });
      hls.on(Hls.Events.FRAG_LOADED, (_, data) => { screen.loaded++; screen.lastSn = data.frag.sn; });
      hls.on(Hls.Events.LEVEL_LOADED, (_, data) => { root.querySelector('.sequence').textContent = `${data.details.startSN} → ${data.details.endSN}`; });
      hls.on(Hls.Events.MANIFEST_PARSED, () => screen.video.play().catch(() => state(screen, 'اضغط تشغيل')));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || !running) return;
        state(screen, `خطأ ${data.response?.code || data.details}`);
        if (Date.now() - screen.retryAt < 5000) return;
        screen.retryAt = Date.now();
        setTimeout(() => { if (!running) return; if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError(); else hls.loadSource(item.url); }, 4000);
      });
      hls.attachMedia(screen.video); hls.loadSource(item.url);
    } else if (screen.video.canPlayType('application/vnd.apple.mpegurl')) {
      screen.video.src = item.url;
      screen.video.play().catch(() => state(screen, 'اضغط تشغيل'));
    } else state(screen, 'HLS غير مدعوم في المتصفح');
  }
  toggle.disabled = false;
  await poll();
}
async function poll() {
  if (!running || polling) return;
  polling = true;
  try {
    await Promise.all(screens.filter(s => s.token && !s.video.paused).map(s => fetch(`/api/pool-heartbeat?token=${encodeURIComponent(s.token)}`, { cache: 'no-store' }).catch(() => {})));
    const result = await api('/api/multiview/status');
    let moving = 0;
    for (const screen of screens) {
      const row = result.screens.find(r => r.channel === screen.channel);
      if (!row) continue;
      screen.root.querySelector('.account').textContent = row.account || 'لم يُحجز حساب';
      screen.root.querySelector('.http').textContent = row.lastHttpCode || '—';
      if (!screen.hls) screen.root.querySelector('.sequence').textContent = row.sequence ?? '—';
      screen.root.querySelector('.segments').textContent = `${screen.lastSn ?? '—'} / ${screen.loaded}`;
      const time = screen.video.currentTime;
      if (time > screen.lastFrame + .1) { screen.movedAt = Date.now(); screen.lastFrame = time; }
      const advancing = Date.now() - screen.movedAt < 6500 && !screen.video.paused;
      if (advancing) moving++;
      const buffered = screen.video.buffered.length ? Math.max(0, screen.video.buffered.end(screen.video.buffered.length - 1) - time) : 0;
      screen.root.querySelector('.buffer').textContent = `${time.toFixed(1)}s / ${buffered.toFixed(1)}s`;
      if (advancing) state(screen, 'الفيديو يتقدم', true);
      else if (row.stagnantForMs > 15000) state(screen, 'المقاطع لا تتقدم');
      else state(screen, screen.video.paused ? 'متوقف' : 'جارٍ التحميل');
    }
    summary.textContent = `${moving} / 6 شاشات يتقدم فيها الفيديو • ${new Date().toLocaleTimeString('ar-MA')}`;
  } catch (error) { summary.textContent = error.message; }
  finally { polling = false; }
}
toggle.addEventListener('click', () => {
  running = !running;
  for (const s of screens) {
    if (!s.token) continue;
    if (running) { s.hls?.startLoad(); s.video.play().catch(() => {}); }
    else { s.hls?.stopLoad(); s.video.pause(); state(s, 'متوقف'); }
  }
  toggle.textContent = running ? 'إيقاف الكل' : 'تشغيل الكل';
  if (!running) summary.textContent = 'الاختبار متوقف'; else void poll();
});
window.addEventListener('pagehide', () => { running = false; for (const s of screens) s.hls?.destroy(); });
setInterval(poll, 3000);
start().catch(error => { summary.textContent = error.message; });
