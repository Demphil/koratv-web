/* global Hls, STREAM_API_ORIGIN */
const video = document.getElementById('video');
const status = document.getElementById('status');
const params = new URL(location.href).searchParams;
const entry = params.get('k') || params.get('token');
history.replaceState(null, '', location.pathname);
let hls;
let expiryTimer;
const notifyParent = (state, message = '') => {
  if (window.parent !== window) window.parent.postMessage({ source: 'koratv-player', state, message }, '*');
};
async function start() {
  notifyParent('connecting');
  if (!entry) throw new Error('Missing playback ticket. Open the match again.');
  if (!Hls.isSupported()) throw new Error('This browser does not support the required MediaSource playback.');
  const response = await fetch(`${STREAM_API_ORIGIN}/api/redeem-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: entry }), credentials: 'omit',
  });
  if (!response.ok) throw new Error('Playback ticket expired, was already used, or access was denied.');
  const { token, expiresIn } = await response.json();
  hls = new Hls({ enableWorker: true });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) {
      hls.destroy();
      showError('تعذر تشغيل البث الآن', 'مصدر القناة غير متوفر حالياً.');
      notifyParent('error', 'تعذر تحميل البث من مصدر القناة.');
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    status.textContent = '';
    status.classList.remove('error');
    notifyParent('ready');
  });
  hls.loadSource(`${STREAM_API_ORIGIN}/api/stream.m3u8?token=${encodeURIComponent(token)}`);
  hls.attachMedia(video);
  expiryTimer = setTimeout(() => {
    hls.destroy();
    video.removeAttribute('src');
    video.load();
    showError('انتهت جلسة المشاهدة', 'أعد فتح المباراة للمتابعة.');
    notifyParent('error', 'انتهت جلسة المشاهدة. أعد فتح المباراة للمتابعة.');
  }, expiresIn * 1000);
}
function showError(title, message) {
  status.classList.add('error');
  status.innerHTML = `<div class="player-error-box"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span><a href="https://koratv.click/">حسناً، فهمت</a></div>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadWatchNews() {
  const container = document.getElementById('watch-news-container');
  if (!container) return;
  try {
    const feeds = [
      'https://arabic.rt.com/rss/sport/',
      'https://www.skynewsarabia.com/web/rss/sport'
    ];
    const responses = await Promise.all(feeds.map((feed) =>
      fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`).catch(() => null)
    ));
    const payloads = await Promise.all(responses.map((response) => response?.ok ? response.json() : { items: [] }));
    const items = payloads.flatMap((payload) => payload.items || [])
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
      .slice(0, 4);
    container.innerHTML = items.length ? items.map((item) => {
      const title = item.title || 'أحدث الأخبار الرياضية';
      const image = item.thumbnail || item.enclosure?.link || 'https://koratv.click/assets/images/default-news.jpg';
      const date = item.pubDate ? new Date(item.pubDate.replace(/-/g, '/')).toLocaleDateString('ar-EG-u-nu-latn') : '';
      return `<a class="watch-news-card" href="${escapeHtml(item.link || '#')}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy"><div><h4>${escapeHtml(title)}</h4><span>${escapeHtml(date)}</span></div></a>`;
    }).join('') : '<p>لا توجد أخبار حالياً.</p>';
  } catch {
    container.innerHTML = '<p>حدث خطأ أثناء تحميل الأخبار.</p>';
  }
}

video.addEventListener('playing', () => {
  status.textContent = '';
  status.classList.remove('error');
  notifyParent('playing');
});
// Convenience restrictions only. Browser menus and network inspection remain accessible.
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.key === 'F12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && /^[ijc]$/i.test(event.key))) event.preventDefault();
});
window.addEventListener('pagehide', () => { clearTimeout(expiryTimer); hls?.destroy(); });
loadWatchNews();
start().catch(() => {
  showError('عذراً، البث غير متاح الآن', 'مصدر القناة غير متوفر حالياً.');
  notifyParent('error', 'تعذر إنشاء اتصال آمن مع البث.');
});
