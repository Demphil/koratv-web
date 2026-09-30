/* global Hls, Plyr, STREAM_API_ORIGIN, STREAM_API_ORIGINS */
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
const embeddedMatchId = (params.get('match') || '').slice(0, 160);
history.replaceState(null, '', location.pathname + (embeddedMatchId ? `?match=${encodeURIComponent(embeddedMatchId)}` : ''));
let hls;
let expiryTimer;
let hlsSessionToken = "";
let activeMatchId = "";
let currentQuality = "";
let availableQualities = [];
let singleQuality = false;
let poolHeartbeatTimer;
let player;
let loadTimer;
let retryTimer;
let qualityStallTimer;
let stallRecoveryTimer;
let matchTimer;
let networkRetries = 0;
let mediaRetries = 0;
let sessionExpiresAt = 0;
let selectedManualHeight = 0;
let reconnectAttempt = 0;
let lastReadyAt = 0;
let lastStallRecoveryAt = 0;
let currentMatchInfo = null;
let selectedMatchTab = 'details';
let selectedLineupSide = 'home';
let matchPanelRequestSequence = 0;
let resumeAfterQualityChange = false;
const sessionKey = 'koratv-playback-session';
const lastMatchKey = 'koratv-last-match-id';
const arabicTeamNames = new Map(Object.entries({
  argentina: 'الأرجنتين', australia: 'أستراليا', belgium: 'بلجيكا', brazil: 'البرازيل',
  canada: 'كندا', china: 'الصين', croatia: 'كرواتيا', denmark: 'الدنمارك',
  egypt: 'مصر', england: 'إنجلترا', finland: 'فنلندا', france: 'فرنسا',
  germany: 'ألمانيا', ghana: 'غانا', greece: 'اليونان', hungary: 'المجر',
  iran: 'إيران', iraq: 'العراق', italy: 'إيطاليا', japan: 'اليابان',
  jordan: 'الأردن', mexico: 'المكسيك', morocco: 'المغرب', netherlands: 'هولندا',
  nigeria: 'نيجيريا', norway: 'النرويج', portugal: 'البرتغال', qatar: 'قطر',
  'saudi arabia': 'السعودية', scotland: 'اسكتلندا', senegal: 'السنغال', serbia: 'صربيا',
  'south africa': 'جنوب أفريقيا', 'south korea': 'كوريا الجنوبية', spain: 'إسبانيا',
  sweden: 'السويد', switzerland: 'سويسرا', tunisia: 'تونس', turkey: 'تركيا',
  ukraine: 'أوكرانيا', 'united states': 'الولايات المتحدة', uruguay: 'الأوروغواي', wales: 'ويلز'
}));
const MAX_RECONNECT_ATTEMPTS = 3;
const MAX_MEDIA_RECOVERIES = 2;
const INITIAL_LOAD_TIMEOUT_MS = 18000;
const QUALITY_STALL_TIMEOUT_MS = 7000;
const RETRY_BASE_DELAY_MS = 900;
const EMBED_HASH_LENGTH = 12;
const PROTECTED_SELECTOR = '[data-integrity-protected="true"]';
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
  const matchId = activeMatchId || embeddedMatchId || decodeJwtPayload(entry || '').matchId;
  if (!matchId) return '';
  const url = new URL('/watch.html', window.location.origin);
  url.searchParams.set('match', matchId);
  return url.href;
}

function iframeCode() {
  const src = embedSrc();
  if (!src) return '';
  return `<iframe src="${src}" title="KoraTV" width="100%" style="display:block;width:100%;aspect-ratio:16/9;height:auto;border:0;background:#000" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}

function openEmbedModal() {
  if (!embedModal || !embedCode) return;
  const code = iframeCode();
  embedCode.value = code || 'افتح مباراة أولاً للحصول على رابط التضمين الخاص بها.';
  if (copyEmbedCode) copyEmbedCode.disabled = !code;
  embedModal.hidden = false;
  if (!embedModal.open) embedModal.showModal();
  embedCode.focus();
  embedCode.select();
}

function closeEmbedModal() {
  if (embedModal?.open) embedModal.close();
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
  // Optional ads and small embedded viewports must never interrupt playback.
  return true;
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
    if (element.style.opacity !== '' && Number.isFinite(inlineOpacity) && inlineOpacity <= 0.05) return false;
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

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text || /^null$/i.test(text) || /^undefined$/i.test(text)) return fallback;
  return text;
}

function cleanScore(value) {
  const score = cleanText(value);
  if (!score || /^vs$/i.test(score) || /null|undefined/i.test(score)) return 'VS';
  const parts = score.split('-').map((part) => cleanText(part));
  if (parts.length >= 2 && parts[0] !== '' && parts[1] !== '') return `${parts[0]} - ${parts[1]}`;
  return 'VS';
}

function teamInitials(value) {
  return cleanText(value, 'TV').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function formatEventMinute(event) {
  const elapsed = Number(event.elapsed || event.minute);
  if (!Number.isFinite(elapsed)) return 'حدث';
  return `${elapsed}${event.extra ? `+${event.extra}` : ''}'`;
}

function renderPlayerCard(player) {
  const grid = String(player.grid || '').match(/^([1-5]):([1-5])$/);
  const slot = player.pitchSlot ? 'lineup-positioned' : grid ? `slot-${grid[1]}-${grid[2]}` : 'lineup-unplaced';
  const position = player.pitchSlot ? ` data-pitch-x="${player.pitchSlot.x}" data-pitch-y="${player.pitchSlot.y}"` : '';
  const photo = player.photo ? `<img src="${escapeHtml(player.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="lineup-player-placeholder">${escapeHtml(teamInitials(player.name))}</span>`;
  return `<div class="lineup-player ${slot}"${position} title="${escapeHtml(player.name)}">${photo}<b>${escapeHtml(String(player.number || ''))}</b><span>${escapeHtml(cleanText(player.name, 'لاعب'))}</span></div>`;
}

function positionLineup(players) {
  const rows = new Map();
  for (const player of players) {
    const grid = String(player.grid || '').match(/^([1-5]):([1-5])$/);
    if (!grid) continue;
    const row = Number(grid[1]);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push({ ...player, column: Number(grid[2]) });
  }
  return [...rows.keys()].sort((a, b) => a - b).flatMap((row, index, keys) =>
    rows.get(row).sort((a, b) => a.column - b.column).map((player, column, group) => ({
      ...player, pitchSlot: { x: 100 * (column + 1) / (group.length + 1), y: 12 + index * 76 / Math.max(1, keys.length - 1) },
    })));
}

function lineupForSide(match, side) {
  const teamName = side === 'home' ? match.homeTeam : match.awayTeam;
  const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
  return (match.lineups || []).find((lineup) => (teamId && String(lineup.teamId) === String(teamId))
    || normalizeTeamNameForUi(lineup.team) === normalizeTeamNameForUi(teamName));
}

function normalizeTeamNameForUi(value) {
  return cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function arabicTeamLabel(match, side) {
  const supplied = cleanText(match?.[`${side}TeamArabic`]);
  if (supplied) return supplied;
  const name = cleanText(match?.[`${side}Team`]);
  if (/[\u0600-\u06ff]/.test(name)) return name;
  return arabicTeamNames.get(normalizeTeamNameForUi(name)) || '';
}

function updateChannelLabel(channelName) {
  const channel = cleanText(channelName);
  const label = document.getElementById('match-channel-name');
  if (label) label.textContent = channel ? `القناة المرتبطة: ${channel}` : 'لم تُحدد قناة موثقة لهذه المباراة';
}

function renderLineups(match) {
  const lineup = lineupForSide(match, selectedLineupSide);
  const home = selectedLineupSide === 'home';
  const teamName = home ? match.homeTeam : match.awayTeam;
  const players = lineup?.startXI || [];
  const placed = positionLineup(players);
  const unplaced = players.filter((player) => !/^([1-5]):([1-5])$/.test(String(player.grid || '')));
  const teamButtons = `
    <div class="lineup-team-switch" role="group" aria-label="اختيار الفريق">
      <button type="button" data-lineup-side="home" aria-pressed="${home}">${escapeHtml(match.homeTeam)}</button>
      <button type="button" data-lineup-side="away" aria-pressed="${!home}">${escapeHtml(match.awayTeam)}</button>
    </div>`;
  if (!lineup || !players.length) return `${teamButtons}<p class="empty-match-data">لم تصل التشكيلة الرسمية لهذه المباراة بعد.</p>`;
  const pitch = placed.length ? `
    <div class="lineup-pitch lineup-coordinate-pitch" aria-label="تشكيلة ${escapeHtml(teamName)}">
      <div class="pitch-lines" aria-hidden="true"></div>
      ${placed.map(renderPlayerCard).join('')}
    </div>` : '';
  return `${teamButtons}
    <div class="lineup-heading"><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(lineup.formation || 'التشكيلة الأساسية')}</span></div>
    ${pitch}
    ${unplaced.length ? `<div class="lineup-gallery">${unplaced.map(renderPlayerCard).join('')}</div>` : ''}
    <div class="lineup-meta">${lineup.coach ? `<span>المدرب: ${escapeHtml(lineup.coach)}</span>` : ''}<span>البدلاء: ${(lineup.substitutes || []).length}</span></div>
    ${(lineup.substitutes || []).length ? `<h4 class="lineup-subtitle">البدلاء</h4><div class="lineup-gallery">${lineup.substitutes.map(renderPlayerCard).join('')}</div>` : ''}`;
}

function renderMatchDetail(tab, match) {
  if (!match) return '<p class="empty-match-data">جاري تحميل بيانات المباراة...</p>';
  if (tab === 'lineups') return renderLineups(match);
  if (tab === 'standings') {
    const table = Array.isArray(match.standings) ? match.standings : [];
    return table.length ? `<div class="standings-table-wrap"><table class="match-standings"><thead><tr><th>#</th><th>الفريق</th><th>لعب</th><th>فارق</th><th>نقاط</th></tr></thead><tbody>${table.map((row) => `<tr><td>${escapeHtml(row.rank || '')}</td><th>${escapeHtml(row.team || row.name || '')}</th><td>${escapeHtml(row.played ?? '')}</td><td>${escapeHtml(row.goalDifference ?? '')}</td><td><strong>${escapeHtml(row.points ?? '')}</strong></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty-match-data">جدول الترتيب غير متوفر في بيانات هذه المباراة حالياً.</p>';
  }
  const statisticGroups = Array.isArray(match.statistics) ? match.statistics : [];
  const stats = statisticGroups.length === 2 ? new Map(statisticGroups.map((team) => [team.team, new Map(team.statistics.map((item) => [item.type, item.value]))])) : null;
  const statRows = stats ? [...new Set(statisticGroups.flatMap((team) => team.statistics.map((item) => item.type)))].map((type) => {
    const values = statisticGroups.map((team) => [...team.statistics].find((item) => item.type === type)?.value ?? '--');
    return `<div class="match-stat-row"><b>${escapeHtml(String(values[0]))}</b><span>${escapeHtml(type)}</span><b>${escapeHtml(String(values[1]))}</b></div>`;
  }).join('') : '<p class="empty-match-data">إحصاءات الاستحواذ والتسديد تظهر عند وصولها من مزود المباراة.</p>';
  const events = Array.isArray(match.events) && match.events.length ? match.events : (match.goals || []).map((goal) => ({ ...goal, type: 'Goal', detail: 'Goal' }));
  const eventHtml = events.map((event) => `<div class="match-event"><time>${escapeHtml(formatEventMinute(event))}</time><span><b>${escapeHtml(event.player || event.detail || event.type || 'حدث')}</b><small>${escapeHtml([event.team, event.assist ? `تمريرة: ${event.assist}` : '', event.detail].filter(Boolean).join(' · '))}</small></span></div>`).join('');
  return `<div class="match-context-row"><span>${escapeHtml(cleanText(match.league, ''))}</span><b>${escapeHtml(cleanText(match.venue, ''))}${match.venueCity ? ` · ${escapeHtml(match.venueCity)}` : ''}</b>${match.referee ? `<span>الحكم: ${escapeHtml(match.referee)}</span>` : ''}</div>
    <div class="live-match-events">${eventHtml || `<p class="empty-match-data">${match.eventDetailsLoaded ? 'لا توجد أحداث مسجلة حتى الآن.' : 'تفاصيل المباراة لم تصل من API-Football بعد.'}</p>`}</div>
    <div class="live-match-statistics">${statRows}</div>`;
}

function activateMatchApiNode(node) {
  const map = node.closest('.match-api-map');
  if (!map) return;
  map.querySelectorAll('.match-api-node').forEach((item) => {
    const selected = item === node;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  selectedMatchTab = node.dataset.endpoint || 'details';
  const detail = document.getElementById('match-api-detail');
  if (detail) {
    detail.innerHTML = renderMatchDetail(selectedMatchTab, currentMatchInfo);
    detail.querySelectorAll('[data-pitch-x]').forEach(player => {
      player.style.left = `${Number(player.dataset.pitchX)}%`;
      player.style.top = `${Number(player.dataset.pitchY)}%`;
    });
  }
}

function renderMatchPanel() {
  const tab = document.querySelector(`.match-api-node[data-endpoint="${selectedMatchTab}"]`);
  if (tab) activateMatchApiNode(tab);
}

async function loadMatchPanel(matchId) {
  if (!matchId) return;
  const requestSequence = ++matchPanelRequestSequence;
  try {
    const response = await fetch(`${STREAM_API_ORIGIN}/api/match-info?matchId=${encodeURIComponent(matchId)}`, {
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!response.ok) return;
    const { match } = await response.json();
    if (requestSequence !== matchPanelRequestSequence || activeMatchId !== matchId) return;
    if (!match || match.matchId !== matchId) return;
    currentMatchInfo = match;
    const panel = document.getElementById('match-panel');
    panel.hidden = false;
    setText('match-league', match.league || 'Koratv.click');
    setText('match-state-pill', match.playbackState === 'ended' ? 'انتهت' : match.playbackState === 'live' ? 'مباشر الآن' : 'قريباً');
    setText('match-home-name', match.homeTeam || '');
    setText('match-away-name', match.awayTeam || '');
    const homeArabic = document.getElementById('match-home-name-ar');
    const awayArabic = document.getElementById('match-away-name-ar');
    if (homeArabic) { homeArabic.textContent = arabicTeamLabel(match, 'home'); homeArabic.hidden = !homeArabic.textContent || homeArabic.textContent === match.homeTeam; }
    if (awayArabic) { awayArabic.textContent = arabicTeamLabel(match, 'away'); awayArabic.hidden = !awayArabic.textContent || awayArabic.textContent === match.awayTeam; }
    setText('match-score', cleanScore(match.score));
    setText('match-minute', match.playbackState === 'ended' ? 'النتيجة النهائية' : match.liveMinute != null && Number.isFinite(Number(match.liveMinute)) ? `الدقيقة ${match.liveMinute}` : match.time || '');
    setText('match-yellow-cards', String(cardTotal(match.yellowCards)));
    setText('match-red-cards', String(cardTotal(match.redCards)));
    setImage('match-home-logo', match.homeLogo);
    setImage('match-away-logo', match.awayLogo);
    updateChannelLabel(match.channelName);
    renderMatchPanel();
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
  const readStoredSession = () => {
    try { return JSON.parse(sessionStorage.getItem(sessionKey)); } catch { return null; }
  };
  const rememberMatchId = (matchId) => {
    const value = String(matchId || '').trim().slice(0, 160);
    if (!value) return;
    try { localStorage.setItem(lastMatchKey, value); } catch {}
  };
  const readRememberedMatchId = () => {
    try { return String(localStorage.getItem(lastMatchKey) || '').trim().slice(0, 160); } catch { return ''; }
  };
  const isUsableSession = (value, matchId = '') => Boolean(
    value?.token
    && value.expiresAt > Date.now() + 5000
    && (!matchId || value.matchId === matchId)
  );
  const createSessionForMatch = async (matchId) => {
    const ticketResponse = await fetch(`${STREAM_API_ORIGIN}/api/generate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
      credentials: 'omit',
      signal: AbortSignal.timeout(12000),
    });
    if (!ticketResponse.ok) throw new Error('تعذر إنشاء رابط مشاهدة لهذه المباراة حالياً.');
    const ticket = await ticketResponse.json();
    const response = await fetch(`${STREAM_API_ORIGIN}/api/redeem-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ticket.token }),
      credentials: 'omit',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('تعذر فتح جلسة المشاهدة.');
    const data = await response.json();
    if (!data.token || !(data.expiresIn > 0)) throw new Error('تعذر إنشاء جلسة المشاهدة.');
    return { token: data.token, singleQuality: data.singleQuality === true, qualities: data.qualities || [], channelName: data.channelName || ticket.channelName || '', matchId, expiresAt: Date.now() + data.expiresIn * 1000 };
  };
  if (embeddedMatchId) {
    activeMatchId = embeddedMatchId;
    rememberMatchId(activeMatchId);
    const stored = readStoredSession();
    session = isUsableSession(stored, embeddedMatchId) ? stored : await createSessionForMatch(embeddedMatchId);
    try { sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch {}
  } else if (entry) {
    activeMatchId = decodeJwtPayload(entry).matchId || '';
    rememberMatchId(activeMatchId);
    loadMatchPanel(activeMatchId);
    const stored = readStoredSession();
    if (isUsableSession(stored, activeMatchId)) {
      session = stored;
    } else {
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
      if (!response.ok) {
        if (isUsableSession(stored, activeMatchId)) session = stored;
        else throw new Error(response.status === 403
          ? 'انتهت صلاحية رابط المشاهدة. افتح المباراة مجدداً من الموقع.'
          : 'تعذر الاتصال بخادم المشاهدة. حاول فتح المباراة مرة أخرى.');
      } else {
        const data = await response.json();
        if (!data.token || !(data.expiresIn > 0)) throw new Error('تعذر إنشاء جلسة المشاهدة.');
        session = { token: data.token, singleQuality: data.singleQuality === true, qualities: data.qualities || [], channelName: data.channelName || '', matchId: activeMatchId, expiresAt: Date.now() + data.expiresIn * 1000 };
        try { sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch {}
      }
    }
  } else {
    session = readStoredSession();
    if (!isUsableSession(session)) {
      const recoveredMatchId = session?.matchId || readRememberedMatchId();
      if (!recoveredMatchId) throw new Error('افتح المباراة المطلوبة من الموقع للمتابعة.');
      session = await createSessionForMatch(recoveredMatchId);
      try { sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch {}
    }
  }
  if (!session?.token || session.expiresAt <= Date.now()) throw new Error('انتهت جلسة المشاهدة. افتح المباراة من الموقع للمتابعة.');
  hlsSessionToken = session.token;
  activeMatchId = session.matchId;
  rememberMatchId(activeMatchId);
  sessionExpiresAt = session.expiresAt;
  availableQualities = Array.isArray(session.qualities) ? session.qualities : [];
  singleQuality = session.singleQuality === true;
  clearInterval(poolHeartbeatTimer);
  if (singleQuality) poolHeartbeatTimer = setInterval(() => {
    if (!hlsSessionToken || video.paused || sessionExpiresAt <= Date.now()) return;
    fetch(`${STREAM_API_ORIGIN}/api/pool-heartbeat`, { headers: { Authorization: `Bearer ${hlsSessionToken}` }, cache: 'no-store', signal: AbortSignal.timeout(4000) }).catch(() => {});
  }, 5000);
  updateChannelLabel(session.channelName);
  loadMatchPanel(activeMatchId);
  matchTimer = setInterval(() => { if (!document.hidden) loadMatchPanel(activeMatchId); }, 15000);
  connectStream(0);
  expiryTimer = setTimeout(() => {
    try { sessionStorage.removeItem(sessionKey); } catch {}
    failPlayback('انتهت جلسة المشاهدة. افتح المباراة من الموقع للمتابعة.', false);
  }, sessionExpiresAt - Date.now());
}

function isAllowedStreamApiUrl(url) {
  return STREAM_API_ORIGINS.has(new URL(url).origin);
}

function hlsOptions() {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startLevel: -1,
    capLevelToPlayerSize: true,
    autoStartLoad: true,
    startFragPrefetch: true,
    maxBufferLength: 45,
    maxMaxBufferLength: 90,
    maxBufferSize: 64 * 1000 * 1000,
    backBufferLength: 30,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 10,
    liveDurationInfinity: true,
    maxLiveSyncPlaybackRate: 1.05,
    maxBufferHole: 0.5,
    highBufferWatchdogPeriod: 2,
    nudgeOffset: 0.2,
    nudgeMaxRetry: 6,
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
      if (!isAllowedStreamApiUrl(url)) throw new Error('Unexpected media origin');
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
  showLoading(attempt ? 'البث غير متوفر حالياً - جاري المحاولة...' : 'جاري الاتصال بالبث...', attempt ? `إعادة المحاولة ${attempt}/${MAX_RECONNECT_ATTEMPTS}` : 'جاري تحميل القناة');
  armLoadTimeout();
  hls = new Hls(hlsOptions());
  hls.on(Hls.Events.ERROR, (_, data) => {
    if ([409, 503].includes(data.response?.code)) {
      clearTimeout(loadTimer); clearTimeout(retryTimer);
      hls.stopLoad();
      showLoading('جاري انتظار خط بث متاح', 'تتم إعادة المحاولة تلقائياً للمباراة نفسها');
      retryTimer = setTimeout(() => connectStream(0), 3000);
      return;
    }
    if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
      scheduleStallRecovery();
      return;
    }
    if (!data.fatal) return;
    if ([401, 403].includes(data.response?.code)) {
      try { sessionStorage.removeItem(sessionKey); } catch {}
      hlsSessionToken = '';
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
    if (resumeAfterQualityChange) {
      video.addEventListener('canplay', () => {
        if (!resumeAfterQualityChange) return;
        resumeAfterQualityChange = false;
        video.play().catch(() => {});
      }, { once: true });
    }
    if (video.readyState >= 3) clearTimeout(loadTimer);
  });
  hls.on(Hls.Events.LEVEL_SWITCHED, () => {
    if (!selectedManualHeight) currentQuality = '';
  });
  hls.loadSource(streamUrlForQuality(currentQuality));
  hls.attachMedia(video);
}

function scheduleStallRecovery() {
  if (video.paused || !hls || Date.now() - lastStallRecoveryAt < 3500) return;
  clearTimeout(stallRecoveryTimer);
  stallRecoveryTimer = setTimeout(() => {
    if (video.paused || !hls || video.readyState >= 3) return;
    lastStallRecoveryAt = Date.now();
    hls.startLoad(-1);
    const ranges = video.buffered;
    for (let index = 0; index < ranges.length - 1; index += 1) {
      const currentEnd = ranges.end(index);
      const nextStart = ranges.start(index + 1);
      if (currentEnd >= video.currentTime && nextStart - currentEnd <= 1.25) {
        video.currentTime = nextStart + 0.05;
        break;
      }
    }
  }, 1600);
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
  if (hlsSessionToken) url.searchParams.set('token', hlsSessionToken);
  return url.href;
}

function setupQualityControl() {
  const heights = [...new Set((hls?.levels || []).map((level) => level.height).filter((height) => height > 0))].sort((a, b) => b - a);
  const providerHeights = availableQualities.map((quality) => Number(quality.height)).filter((height) => height > 0);
  const options = singleQuality ? [0] : [0, ...new Set([...heights, ...providerHeights].sort((a, b) => b - a))];
  if (player) {
    updateQualityMenu(options);
    return;
  }
  player = new Plyr(video, {
    controls: ['play-large', 'play', 'mute', 'volume', 'fullscreen'],
    settings: [], hideControls: true, resetOnEnd: false,
    keyboard: { focused: false, global: false },
    iconUrl: './plyr.svg', storage: { enabled: false },
    fullscreen: { enabled: true, container: '#player-container', iosNative: false },
    quality: { default: 0, options, forced: true, onChange: changeQuality },
    i18n: { play: 'تشغيل', pause: 'إيقاف مؤقت', mute: 'كتم الصوت', unmute: 'تفعيل الصوت', volume: 'الصوت', settings: 'الإعدادات', quality: 'الجودة', enterFullscreen: 'ملء الشاشة', exitFullscreen: 'تصغير الشاشة', qualityLabel: { 0: 'تلقائي' } },
  });
  const liveButton = document.createElement('button');
  liveButton.type = 'button';
  liveButton.className = 'plyr__control player-live-button';
  liveButton.textContent = 'مباشر';
  liveButton.title = 'العودة إلى البث المباشر';
  liveButton.setAttribute('aria-label', liveButton.title);
  liveButton.addEventListener('click', returnToLive);
  player.elements.controls?.querySelector('[data-plyr="play"]')?.after(liveButton);
}

function returnToLive() {
  const ranges = video.seekable;
  if (!ranges.length) return;
  const start = ranges.start(ranges.length - 1);
  const end = ranges.end(ranges.length - 1);
  const sync = hls?.liveSyncPosition;
  // Never jump to an unavailable edge or a gap in the seekable window.
  const target = Number.isFinite(sync) ? sync : end - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  video.currentTime = Math.max(start, Math.min(target, Math.max(start, end - 0.1)));
  video.play().catch(() => {});
}

function updateQualityMenu(options) {
  player.config.quality.options = options;
  player.options.quality = options;
  const settings = player.elements.settings;
  const list = settings?.panels?.quality?.querySelector('[role="menu"]');
  if (!list) return;
  list.replaceChildren();
  for (const height of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plyr__control';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('data-plyr', 'quality');
    button.setAttribute('value', String(height));
    button.setAttribute('aria-checked', String(height === (selectedManualHeight || 0)));
    button.textContent = height ? `${height}p` : 'تلقائي';
    Object.defineProperty(button, 'checked', {
      get: () => button.getAttribute('aria-checked') === 'true',
      set: (checked) => button.setAttribute('aria-checked', String(checked))
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
  const source = availableQualities.find((quality) => Number(quality.height) === selectedManualHeight);
  if (source?.label) {
    currentQuality = source.label;
    resumeAfterQualityChange = !video.paused;
    armLoadTimeout();
    showLoading('جاري تغيير الجودة...', `${selectedManualHeight}p`);
    hls.loadSource(streamUrlForQuality(currentQuality));
    return;
  }
  const levelIndex = hls.levels.findIndex((level) => Number(level.height) === selectedManualHeight);
  if (levelIndex >= 0) {
    currentQuality = '';
    hls.currentLevel = levelIndex;
    hls.nextLevel = levelIndex;
    return;
  }
  fallbackToAuto('هذه الجودة غير متاحة حالياً. تم الرجوع للوضع التلقائي.');
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
  return String(value ?? '')
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
  clearTimeout(stallRecoveryTimer);
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
document.addEventListener('click', (event) => {
  const tab = event.target.closest?.('.match-api-node');
  if (tab) {
    event.preventDefault();
    activateMatchApiNode(tab);
    return;
  }
  const side = event.target.closest?.('[data-lineup-side]');
  if (side && currentMatchInfo) {
    selectedLineupSide = side.dataset.lineupSide;
    renderMatchPanel();
  }
});
document.addEventListener('keydown', (event) => {
  const node = event.target.closest?.('.match-api-node, [data-lineup-side]');
  if (!node || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (node.matches('.match-api-node')) activateMatchApiNode(node);
  else {
    selectedLineupSide = node.dataset.lineupSide;
    if (currentMatchInfo) renderMatchPanel();
  }
});
embedModal?.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-embed]')) closeEmbedModal();
});
embedModal?.addEventListener('close', () => { embedModal.hidden = true; });
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
video.addEventListener('canplay', () => { clearTimeout(loadTimer); clearTimeout(stallRecoveryTimer); lastReadyAt = Date.now(); });
video.addEventListener('waiting', () => { monitorQualityStall(); armLoadTimeout(); scheduleStallRecovery(); });
video.addEventListener('stalled', () => { monitorQualityStall(); armLoadTimeout(); scheduleStallRecovery(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadMatchPanel(activeMatchId); });
window.addEventListener('pagehide', () => {
  clearInterval(poolHeartbeatTimer);
  clearTimeout(expiryTimer); clearTimeout(loadTimer); clearTimeout(retryTimer); clearTimeout(stallRecoveryTimer);
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
