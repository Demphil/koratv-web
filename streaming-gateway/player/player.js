/* global Hls, Plyr, STREAM_API_ORIGIN */
const video = document.getElementById('video');
const status = document.getElementById('status');
const params = new URL(location.href).searchParams;
const entry = params.get('k') || params.get('token');
history.replaceState(null, '', location.pathname);
let hls;
let expiryTimer;
let hlsSessionToken = "";
let activeMatchId = "";
let currentQuality = "";
let availableQualities = [];
let player;
let loadTimer;
let retryTimer;
let matchTimer;
let networkRetries = 0;
let mediaRetries = 0;
let sessionExpiresAt = 0;
const sessionKey = 'koratv-playback-session';
const notifyParent = (state, message = '') => {
  if (window.parent !== window) window.parent.postMessage({ source: 'koratv-player', state, message }, '*');
};

function embedIntegrityOk() {
  if (window.self === window.top) return true;
  const viewportOk = window.innerWidth >= 320 && window.innerHeight >= 420;
  const ads = [...document.querySelectorAll('.ad-sidebar')];
  const adsOk = ads.length >= 2 && ads.every((ad) => {
    const style = getComputedStyle(ad);
    const rect = ad.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity) > 0
      && rect.width >= 90
      && rect.height >= 80;
  });
  return viewportOk && adsOk;
}

function enforceEmbedIntegrity() {
  if (embedIntegrityOk()) return true;
  hls?.destroy();
  video.removeAttribute('src');
  video.load();
  showError('تعذر تشغيل البث', 'يجب تضمين المشغل كاملاً بدون قص أو إخفاء عناصر الصفحة.');
  notifyParent('error', 'player_integrity_failed');
  return false;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function cardTotal(cards) {
  if (!cards || typeof cards !== 'object') return 0;
  return Number(cards.home || 0) + Number(cards.away || 0);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || '';
}

function setImage(id, src) {
  const element = document.getElementById(id);
  if (!element) return;
  if (src) {
    element.src = src;
    element.hidden = false;
  } else {
    element.hidden = true;
  }
}

async function loadMatchPanel(matchId) {
  if (!matchId) return;
  try {
    const response = await fetch(`${STREAM_API_ORIGIN}/api/match-info?matchId=${encodeURIComponent(matchId)}`, {
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!response.ok) return;
    const { match } = await response.json();
    if (!match) return;
    const panel = document.getElementById('match-panel');
    panel.hidden = false;
    setText('match-league', match.league || 'Koratv.click');
    setText('match-state-pill', match.playbackState === 'ended' ? 'انتهت' : match.playbackState === 'live' ? 'مباشر الآن' : 'قريباً');
    setText('match-home-name', match.homeTeam || '');
    setText('match-away-name', match.awayTeam || '');
    setText('match-score', match.score || 'VS');
    setText('match-minute', match.playbackState === 'ended' ? 'النتيجة النهائية' : match.liveMinute != null && Number.isFinite(Number(match.liveMinute)) ? `الدقيقة ${match.liveMinute}` : match.time || '');
    setText('match-yellow-cards', String(cardTotal(match.yellowCards)));
    setText('match-red-cards', String(cardTotal(match.redCards)));
    setImage('match-home-logo', match.homeLogo);
    setImage('match-away-logo', match.awayLogo);
    const goals = document.getElementById('match-goals');
    const scorers = Array.isArray(match.goals) ? match.goals.filter((goal) => goal?.player).slice(0, 8) : [];
    goals.innerHTML = scorers.map((goal) => `<span>${escapeHtml(goal.minute ? `${goal.minute}' ` : '')}${escapeHtml(goal.player)}</span>`).join('');
  } catch {
    // Match context is decorative; playback should not fail if it is unavailable.
  }
}

async function start() {
  if (!enforceEmbedIntegrity()) return;
  notifyParent('connecting');
  if (!Hls.isSupported()) throw new Error('المتصفح لا يدعم تشغيل هذا البث. يرجى تحديثه أو استخدام متصفح حديث.');
  let session;
  if (entry) {
    try { sessionStorage.removeItem(sessionKey); } catch {}
    activeMatchId = decodeJwtPayload(entry).matchId || '';
    loadMatchPanel(activeMatchId);
    const response = await fetch(`${STREAM_API_ORIGIN}/api/redeem-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: entry }), credentials: 'omit',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 403
      ? 'انتهت صلاحية رابط المشاهدة. افتح المباراة مجدداً من الموقع.'
      : 'تعذر الاتصال بخادم المشاهدة. حاول فتح المباراة مرة أخرى.');
    const data = await response.json();
    if (!data.token || !(data.expiresIn > 0)) throw new Error('تعذر إنشاء جلسة المشاهدة.');
    session = { token: data.token, qualities: data.qualities || [], matchId: activeMatchId, expiresAt: Date.now() + data.expiresIn * 1000 };
    try { sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch {}
  } else {
    try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
  }
  if (!session?.token || session.expiresAt <= Date.now()) throw new Error('انتهت جلسة المشاهدة. افتح المباراة من الموقع للمتابعة.');
  hlsSessionToken = session.token;
  activeMatchId = session.matchId;
  sessionExpiresAt = session.expiresAt;
  availableQualities = Array.isArray(session.qualities) ? session.qualities : [];
  loadMatchPanel(activeMatchId);
  matchTimer = setInterval(() => { if (!document.hidden) loadMatchPanel(activeMatchId); }, 15000);
  connectStream();
  expiryTimer = setTimeout(() => {
    try { sessionStorage.removeItem(sessionKey); } catch {}
    failPlayback('انتهت جلسة المشاهدة. افتح المباراة من الموقع للمتابعة.', false);
  }, sessionExpiresAt - Date.now());
}

function connectStream() {
  clearTimeout(retryTimer);
  hls?.destroy();
  status.classList.remove('error');
  status.textContent = 'جاري الاتصال بالبث...';
  armLoadTimeout();
  hls = new Hls({
    enableWorker: true,
    maxBufferLength: 30,
    backBufferLength: 30,
    capLevelToPlayerSize: true,
    xhrSetup(xhr, url) {
      if (new URL(url).origin !== new URL(STREAM_API_ORIGIN).origin) throw new Error('Unexpected media origin');
      xhr.setRequestHeader('Authorization', `Bearer ${hlsSessionToken}`);
    }
  });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    if ([401, 403].includes(data.response?.code)) {
      failPlayback('انتهت جلسة المشاهدة أو رُفض الوصول. افتح المباراة مجدداً من الموقع.', false);
    } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2) {
      networkRetries += 1;
      status.textContent = 'جاري إعادة الاتصال...';
      retryTimer = setTimeout(() => hls?.startLoad(), networkRetries * 1500);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 1) {
      mediaRetries += 1;
      hls.recoverMediaError();
    } else {
      failPlayback('البث غير متوفر حالياً. يمكنك إعادة المحاولة بعد قليل.');
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setupQualityControl();
    status.textContent = '';
    status.classList.remove('error');
    notifyParent('ready');
    if (video.readyState >= 3) clearTimeout(loadTimer);
  });
  hls.loadSource(streamUrlForQuality(currentQuality));
  hls.attachMedia(video);
}

function armLoadTimeout() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => failPlayback('تأخر وصول البث. تحقق من الاتصال أو أعد المحاولة.'), 30000);
}

function failPlayback(message, retry = true) {
  clearTimeout(loadTimer);
  clearTimeout(retryTimer);
  hls?.destroy();
  hls = null;
  showError('البث غير متوفر حالياً', message, retry && sessionExpiresAt > Date.now());
  notifyParent('error', message);
}

function streamUrlForQuality(quality) {
  const url = new URL(`${STREAM_API_ORIGIN}/api/stream.m3u8`);
  if (quality) url.searchParams.set('quality', quality);
  return url.href;
}

function setupQualityControl() {
  const heights = [...new Set((hls?.levels || []).map((level) => level.height).filter((height) => height > 0))].sort((a, b) => b - a);
  const providerHeights = availableQualities.map((quality) => Number(quality.height)).filter((height) => height > 0);
  const options = [0, ...new Set(heights.length > 1 ? heights : [...heights, ...providerHeights])];
  if (player) {
    updateQualityMenu(options);
    return;
  }
  player = new Plyr(video, {
    controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
    settings: ['quality'], hideControls: true, resetOnEnd: false,
    iconUrl: './plyr.svg', storage: { enabled: false },
    fullscreen: { enabled: true, container: '#player-container', iosNative: false },
    quality: { default: 0, options, forced: true, onChange: (height) => {
      if (!hls) return;
      const levelIndex = hls.levels.findIndex((level) => level.height === height);
      if (!height && !currentQuality) { hls.currentLevel = -1; return; }
      if (height && levelIndex >= 0) { hls.currentLevel = levelIndex; return; }
      const source = availableQualities.find((quality) => Number(quality.height) === height);
      currentQuality = source?.label || '';
      armLoadTimeout();
      hls.loadSource(streamUrlForQuality(currentQuality));
    } },
    i18n: { play: 'تشغيل', pause: 'إيقاف مؤقت', mute: 'كتم الصوت', unmute: 'تفعيل الصوت', volume: 'الصوت', settings: 'الإعدادات', quality: 'الجودة', enterFullscreen: 'ملء الشاشة', exitFullscreen: 'تصغير الشاشة', qualityLabel: { 0: 'تلقائي' } },
  });
}

function updateQualityMenu(options) {
  player.config.quality.options = options;
  player.options.quality = options;
  const settings = player.elements.settings;
  const list = settings.panels.quality.querySelector('[role="menu"]');
  list.replaceChildren();
  for (const height of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plyr__control';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('data-plyr', 'quality');
    button.setAttribute('value', String(height));
    button.setAttribute('aria-checked', String(height === (player.quality || 0)));
    button.textContent = height ? `${height}p` : 'تلقائي';
    Object.defineProperty(button, 'checked', {
      get: () => button.getAttribute('aria-checked') === 'true',
      set: (checked) => button.setAttribute('aria-checked', String(checked)),
    });
    button.addEventListener('click', () => {
      for (const item of list.children) item.setAttribute('aria-checked', String(item === button));
      player.quality = height;
    });
    button.addEventListener('keydown', (event) => {
      const items = [...list.children];
      let index = items.indexOf(button);
      if (event.key === 'ArrowDown') index = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') index = (index + items.length - 1) % items.length;
      else return;
      event.preventDefault();
      items[index].focus();
    });
    list.append(button);
  }
  settings.buttons.quality.hidden = options.length < 2;
  settings.menu.hidden = options.length < 2;
  player.elements.buttons.settings.hidden = options.length < 2;
}
function showError(title, message, retry = false) {
  status.classList.add('error');
  status.innerHTML = `<div class="player-error-box"><span class="error-symbol" aria-hidden="true">!</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>${retry ? '<button type="button" id="retry-stream">إعادة المحاولة</button>' : '<a href="https://koratv.click/" target="_blank" rel="noopener">العودة للمباريات</a>'}</div>`;
  document.getElementById('retry-stream')?.addEventListener('click', () => {
    networkRetries = 0;
    mediaRetries = 0;
    connectStream();
  }, { once: true });
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
  clearTimeout(loadTimer);
  networkRetries = 0;
  mediaRetries = 0;
  status.textContent = '';
  status.classList.remove('error');
  notifyParent('playing');
});
// Convenience restrictions only. Browser menus and network inspection remain accessible.
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.key === 'F12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && /^[ijc]$/i.test(event.key))) event.preventDefault();
});
video.addEventListener('canplay', () => clearTimeout(loadTimer));
video.addEventListener('waiting', armLoadTimeout);
video.addEventListener('stalled', armLoadTimeout);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadMatchPanel(activeMatchId); });
window.addEventListener('pagehide', () => {
  clearTimeout(expiryTimer); clearTimeout(loadTimer); clearTimeout(retryTimer);
  clearInterval(matchTimer); hls?.destroy();
});
window.addEventListener('resize', () => {
  if (hls) enforceEmbedIntegrity();
});
setInterval(() => {
  if (hls) enforceEmbedIntegrity();
}, 15000);
loadWatchNews();
setupQualityControl();
start().catch((error) => {
  showError('البث غير متوفر حالياً', error.name === 'TimeoutError' ? 'تعذر الاتصال بالخادم في الوقت المحدد. افتح المباراة مجدداً.' : error.message);
  notifyParent('error', 'تعذر إنشاء اتصال آمن مع البث.');
});
