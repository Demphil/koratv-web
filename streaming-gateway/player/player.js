/* global Hls, Plyr, STREAM_API_ORIGIN */
const video = document.getElementById('video');
const status = document.getElementById('status');
const playerContainer = document.getElementById('player-container');
const embedButton = document.getElementById('embed-button');
const refreshStreamButton = document.getElementById('refresh-stream');
const embedModal = document.getElementById('embed-modal');
const embedCode = document.getElementById('embed-code');
const copyEmbedCode = document.getElementById('copy-embed-code');
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
let qualityStallTimer;
let matchTimer;
let networkRetries = 0;
let mediaRetries = 0;
let sessionExpiresAt = 0;
let selectedManualHeight = 0;
let reconnectAttempt = 0;
let lastReadyAt = 0;
const sessionKey = 'koratv-playback-session';
const MAX_RECONNECT_ATTEMPTS = 3;
const MAX_MEDIA_RECOVERIES = 2;
const INITIAL_LOAD_TIMEOUT_MS = 18000;
const QUALITY_STALL_TIMEOUT_MS = 7000;
const RETRY_BASE_DELAY_MS = 900;
const EMBED_HASH_LENGTH = 12;
const PROTECTED_SELECTOR = '[data-integrity-protected="true"], .broadcast-decoy, .player-brand-overlay, .ad-sidebar';
const OVERLAY_SELECTOR = 'a[href], button, iframe, [onclick], [role="link"]';
let tamperObserver;
let tamperInterval;

const notifyParent = (state, message = '') => {
  if (window.parent !== window) window.parent.postMessage({ source: 'koratv-player', state, message }, '*');
};

function retryDelay(attempt) {
  return Math.min(7000, RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
}

function isFramed() {
  return window.self !== window.top;
}

function randomEmbedHash(length = EMBED_HASH_LENGTH) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function embedSrc() {
  const url = new URL(`/${randomEmbedHash()}`, window.location.origin);
  if (entry) url.searchParams.set('k', entry);
  return url.href;
}

function iframeCode() {
  const src = embedSrc();
  return `<iframe src="${src}" width="100%" height="520" style="border:0;overflow:hidden;background:#000" allow="autoplay; fullscreen; encrypted-media" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}

function openEmbedModal() {
  if (!embedModal || !embedCode) return;
  embedCode.value = iframeCode();
  embedModal.hidden = false;
  embedCode.focus();
  embedCode.select();
}

function closeEmbedModal() {
  if (embedModal) embedModal.hidden = true;
}

async function withRetry(operation, label, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (attempt > 1) showLoading('البث غير متوفر حالياً - جاري المحاولة...', `${label} (${attempt}/${retries})`);
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    }
  }
  throw lastError;
}

function embedIntegrityOk() {
  if (!isFramed()) return true;
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

function elementIsVisible(element) {
  if (!element || !element.isConnected) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity) > 0.05
    && rect.width > 4
    && rect.height > 4;
}

function protectedElementsOk() {
  return [...document.querySelectorAll(PROTECTED_SELECTOR)].every((element) => {
    if (element.matches('.ad-sidebar')) return elementIsVisible(element);
    const style = getComputedStyle(element);
    const inlineOpacity = Number(element.style.opacity);
    if (element.hidden || element.getAttribute('aria-hidden') === 'true' && element.hasAttribute('hidden')) return false;
    if (element.style.display === 'none' || element.style.visibility === 'hidden') return false;
    if (Number.isFinite(inlineOpacity) && inlineOpacity <= 0.05) return false;
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    return true;
  });
}

function elementCoversPlayer(element) {
  if (!element || !playerContainer || playerContainer.contains(element) || element.closest('.embed-modal')) return false;
  const style = getComputedStyle(element);
  if (!['fixed', 'absolute', 'sticky'].includes(style.position) || style.pointerEvents === 'none') return false;
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.05) return false;
  const playerRect = playerContainer.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const overlapX = Math.max(0, Math.min(playerRect.right, rect.right) - Math.max(playerRect.left, rect.left));
  const overlapY = Math.max(0, Math.min(playerRect.bottom, rect.bottom) - Math.max(playerRect.top, rect.top));
  return overlapX * overlapY > Math.min(playerRect.width * playerRect.height * 0.18, 26000);
}

function overlayTamperingDetected() {
  if (!isFramed()) return false;
  return [...document.querySelectorAll(OVERLAY_SELECTOR)].some(elementCoversPlayer);
}

function failTamper(reason) {
  clearTimeout(loadTimer);
  clearTimeout(retryTimer);
  clearTimeout(qualityStallTimer);
  clearInterval(tamperInterval);
  tamperObserver?.disconnect();
  hls?.destroy();
  hls = null;
  try { player?.destroy(); } catch {}
  video.removeAttribute('src');
  video.load();
  document.body.classList.add('tamper-lock');
  showError('تم إيقاف البث', reason || 'تم اكتشاف تعديل غير مسموح به على المشغل.');
  notifyParent('error', 'player_tampering_detected');
}

function enforceEmbedIntegrity() {
  if (embedIntegrityOk()) return true;
  failTamper('يجب تضمين المشغل كاملاً بدون قص أو إخفاء عناصر الصفحة.');
  return false;
}

function enforceTamperState() {
  if (!isFramed()) return true;
  if (!embedIntegrityOk()) return enforceEmbedIntegrity();
  if (!protectedElementsOk()) {
    failTamper('محاولة إخفاء العلامة أو الإعلانات أوقفت البث فوراً.');
    return false;
  }
  if (overlayTamperingDetected()) {
    failTamper('تم اكتشاف طبقة أو رابط فوق المشغل. توقف البث فوراً.');
    return false;
  }
  return true;
}

function startTamperObserver() {
  if (!isFramed() || tamperObserver) return;
  tamperObserver = new MutationObserver(() => enforceTamperState());
  tamperObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden', 'aria-hidden']
  });
  tamperInterval = setInterval(enforceTamperState, 2500);
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
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
  showLoading('جاري تجهيز البث...', 'يتم إنشاء جلسة مشاهدة آمنة');
  if (!Hls.isSupported()) throw new Error('المتصفح لا يدعم تشغيل هذا البث. يرجى تحديثه أو استخدام متصفح حديث.');
  let session;
  if (entry) {
    try { sessionStorage.removeItem(sessionKey); } catch {}
    activeMatchId = decodeJwtPayload(entry).matchId || '';
    loadMatchPanel(activeMatchId);
    const response = await withRetry(() => fetch(`${STREAM_API_ORIGIN}/api/redeem-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: entry }),
      credentials: 'omit',
      signal: AbortSignal.timeout(12000),
    }).then((result) => {
      if (!result.ok && ![401, 403, 429].includes(result.status)) throw new Error('redeem_retryable');
      return result;
    }), 'جاري فتح رابط المشاهدة');
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
  connectStream(0);
  expiryTimer = setTimeout(() => {
    try { sessionStorage.removeItem(sessionKey); } catch {}
    failPlayback('انتهت جلسة المشاهدة. افتح المباراة من الموقع للمتابعة.', false);
  }, sessionExpiresAt - Date.now());
}

function hlsOptions() {
  return {
    enableWorker: true,
    lowLatencyMode: true,
    startLevel: -1,
    capLevelToPlayerSize: true,
    autoStartLoad: true,
    startFragPrefetch: true,
    maxBufferLength: 10,
    maxMaxBufferLength: 24,
    maxBufferSize: 24 * 1000 * 1000,
    backBufferLength: 18,
    liveSyncDuration: 2,
    liveMaxLatencyDuration: 8,
    liveDurationInfinity: true,
    maxLiveSyncPlaybackRate: 1.15,
    maxBufferHole: 0.35,
    highBufferWatchdogPeriod: 1,
    nudgeOffset: 0.12,
    nudgeMaxRetry: 4,
    manifestLoadingTimeOut: 8000,
    manifestLoadingMaxRetry: 1,
    manifestLoadingRetryDelay: 500,
    manifestLoadingMaxRetryTimeout: 2500,
    levelLoadingTimeOut: 8000,
    levelLoadingMaxRetry: 1,
    levelLoadingRetryDelay: 500,
    levelLoadingMaxRetryTimeout: 2500,
    fragLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 2,
    fragLoadingRetryDelay: 500,
    fragLoadingMaxRetryTimeout: 3000,
    xhrSetup(xhr, url) {
      if (new URL(url).origin !== new URL(STREAM_API_ORIGIN).origin) throw new Error('Unexpected media origin');
      xhr.setRequestHeader('Authorization', `Bearer ${hlsSessionToken}`);
    }
  };
}

function connectStream(attempt = 0) {
  clearTimeout(retryTimer);
  clearTimeout(qualityStallTimer);
  hls?.destroy();
  reconnectAttempt = attempt;
  networkRetries = 0;
  mediaRetries = 0;
  showLoading(attempt ? 'البث غير متوفر حالياً - جاري المحاولة...' : 'جاري الاتصال بالبث...', attempt ? `إعادة المحاولة ${attempt}/${MAX_RECONNECT_ATTEMPTS}` : 'نختار أفضل جودة متاحة');
  armLoadTimeout();
  hls = new Hls(hlsOptions());
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    if ([401, 403].includes(data.response?.code)) {
      failPlayback('انتهت جلسة المشاهدة أو رُفض الوصول. افتح المباراة مجدداً من الموقع.', false);
    } else if (selectedManualHeight && (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR)) {
      fallbackToAuto('الجودة المختارة غير مستقرة. تم الرجوع للوضع التلقائي.');
    } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2) {
      networkRetries += 1;
      showLoading('البث غير متوفر حالياً - جاري المحاولة...', `إعادة تحميل المقطع ${networkRetries}/2`);
      retryTimer = setTimeout(() => hls?.startLoad(), networkRetries * 1500);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < MAX_MEDIA_RECOVERIES) {
      mediaRetries += 1;
      showLoading('جاري إصلاح البث...', `محاولة إصلاح الفيديو ${mediaRetries}/${MAX_MEDIA_RECOVERIES}`);
      hls.recoverMediaError();
    } else {
      scheduleReconnect('تعذر تحميل البث من المصدر.');
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setupQualityControl();
    lastReadyAt = Date.now();
    hideStatus();
    notifyParent('ready');
    if (video.readyState >= 3) clearTimeout(loadTimer);
  });
  hls.on(Hls.Events.LEVEL_SWITCHED, () => {
    if (!selectedManualHeight) currentQuality = '';
  });
  hls.loadSource(streamUrlForQuality(currentQuality));
  hls.attachMedia(video);
}

function armLoadTimeout() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => scheduleReconnect('تأخر وصول البث من المصدر.'), INITIAL_LOAD_TIMEOUT_MS);
}

function scheduleReconnect(reason) {
  clearTimeout(loadTimer);
  clearTimeout(retryTimer);
  if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS && sessionExpiresAt > Date.now()) {
    const nextAttempt = reconnectAttempt + 1;
    const delay = retryDelay(nextAttempt);
    showLoading('البث غير متوفر حالياً - جاري المحاولة...', `${reason} سنعيد الاتصال خلال ${Math.ceil(delay / 1000)} ثواني`);
    retryTimer = setTimeout(() => connectStream(nextAttempt), delay);
    return;
  }
  failPlayback('البث غير متوفر حالياً - حاول لاحقاً.', true);
}

function failPlayback(message, retry = true) {
  clearTimeout(loadTimer);
  clearTimeout(retryTimer);
  clearTimeout(qualityStallTimer);
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
    quality: { default: 0, options, forced: true, onChange: changeQuality },
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

function changeQuality(height) {
  if (!hls) return;
  selectedManualHeight = Number(height) || 0;
  clearTimeout(qualityStallTimer);
  if (!selectedManualHeight) {
    const wasProviderSpecific = Boolean(currentQuality);
    currentQuality = '';
    if (wasProviderSpecific) connectStream(0);
    else hls.currentLevel = -1;
    return;
  }
  const levelIndex = hls.levels.findIndex((level) => Number(level.height) === selectedManualHeight);
  if (levelIndex >= 0) {
    currentQuality = '';
    hls.currentLevel = levelIndex;
    hls.nextLevel = levelIndex;
    return;
  }
  const source = availableQualities.find((quality) => Number(quality.height) === selectedManualHeight);
  currentQuality = source?.label || '';
  if (!currentQuality) {
    fallbackToAuto('هذه الجودة غير متاحة حالياً. تم الرجوع للوضع التلقائي.');
    return;
  }
  armLoadTimeout();
  showLoading('جاري تغيير الجودة...', `${selectedManualHeight}p`);
  hls.loadSource(streamUrlForQuality(currentQuality));
}

function fallbackToAuto(message = 'تم الرجوع تلقائياً لأفضل جودة مستقرة.') {
  selectedManualHeight = 0;
  const wasProviderSpecific = Boolean(currentQuality);
  currentQuality = '';
  clearTimeout(qualityStallTimer);
  if (player) {
    try { player.quality = 0; } catch {}
  }
  showLoading(message, 'Auto');
  if (!hls) return connectStream(0);
  if (wasProviderSpecific) connectStream(0);
  else {
    hls.currentLevel = -1;
    hls.nextLevel = -1;
    hls.startLoad();
  }
}

function monitorQualityStall() {
  clearTimeout(qualityStallTimer);
  if (!selectedManualHeight || !hls || status.classList.contains('error')) return;
  qualityStallTimer = setTimeout(() => {
    if (!selectedManualHeight) return;
    if (video.readyState < 3 || Date.now() - lastReadyAt > QUALITY_STALL_TIMEOUT_MS) {
      fallbackToAuto('الجودة المختارة تتأخر في التحميل. تم الرجوع للوضع التلقائي.');
    }
  }, QUALITY_STALL_TIMEOUT_MS);
}

function showLoading(message, detail = '') {
  status.classList.remove('error');
  status.innerHTML = `<div class="player-loading-box"><span class="stream-spinner" aria-hidden="true"></span><strong>${escapeHtml(message)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
}

function hideStatus() {
  status.textContent = '';
  status.classList.remove('error');
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
  clearTimeout(qualityStallTimer);
  networkRetries = 0;
  mediaRetries = 0;
  reconnectAttempt = 0;
  lastReadyAt = Date.now();
  hideStatus();
  notifyParent('playing');
});
// Convenience restrictions only. Browser menus and network inspection remain accessible.
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.key === 'F12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && /^[ijc]$/i.test(event.key))) event.preventDefault();
  if (event.key === 'Escape') closeEmbedModal();
});
embedButton?.addEventListener('click', openEmbedModal);
refreshStreamButton?.addEventListener('click', () => {
  if (sessionExpiresAt > Date.now() && hlsSessionToken) {
    networkRetries = 0;
    mediaRetries = 0;
    connectStream(0);
  } else {
    location.reload();
  }
});
embedModal?.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-embed]')) closeEmbedModal();
});
copyEmbedCode?.addEventListener('click', async () => {
  if (!embedCode) return;
  embedCode.select();
  try {
    await navigator.clipboard.writeText(embedCode.value);
    copyEmbedCode.textContent = 'تم النسخ';
    setTimeout(() => { copyEmbedCode.textContent = 'نسخ الكود'; }, 1800);
  } catch {
    document.execCommand('copy');
  }
});
video.addEventListener('canplay', () => { clearTimeout(loadTimer); lastReadyAt = Date.now(); });
video.addEventListener('waiting', () => { monitorQualityStall(); armLoadTimeout(); });
video.addEventListener('stalled', () => { monitorQualityStall(); armLoadTimeout(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadMatchPanel(activeMatchId); });
window.addEventListener('pagehide', () => {
  clearTimeout(expiryTimer); clearTimeout(loadTimer); clearTimeout(retryTimer);
  clearInterval(matchTimer); hls?.destroy();
});
window.addEventListener('resize', () => {
  if (hls) enforceTamperState();
});
setInterval(() => {
  if (hls) enforceTamperState();
}, 15000);
startTamperObserver();
loadWatchNews();
setupQualityControl();
start().catch((error) => {
  showError('البث غير متوفر حالياً', error.name === 'TimeoutError' ? 'تعذر الاتصال بالخادم في الوقت المحدد. افتح المباراة مجدداً.' : error.message);
  notifyParent('error', 'تعذر إنشاء اتصال آمن مع البث.');
});
