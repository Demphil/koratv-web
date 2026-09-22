// assets/js/matches.js

import {
  getTodayMatches,
  getTomorrowMatches,
  getMoroccoWallClockNow,
  getMoroccoDay
} from './api.js';

const STREAM_API_ORIGIN = window.__MATCHES_API_ORIGIN__ || 'https://stream-api.koratv.click';
const PLAYER_ORIGIN = 'https://medic.cymru';
const PLAYER_PATH = '/739184.html';
const publicSupabaseConfig = window.__SUPABASE_CONFIG__ || {};
const supabaseClient = window.supabase?.createClient && publicSupabaseConfig.url && publicSupabaseConfig.anonKey
  ? window.supabase.createClient(publicSupabaseConfig.url, publicSupabaseConfig.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

if (!supabaseClient) console.info('[MATCHES] Public Supabase client is not configured; using the server match feed.');

const DOM = {
  featuredContainer: document.getElementById('featured-matches'),
  broadcastContainer: document.getElementById('broadcast-matches'),
  todayContainer: document.getElementById('today-matches'),
  tomorrowContainer: document.getElementById('tomorrow-matches'),
  loadingScreen: document.getElementById('loading'),
  todayTab: document.getElementById('today-tab'),
  tomorrowTab: document.getElementById('tomorrow-tab'),
};

function hideLoading() {
  if (DOM.loadingScreen) DOM.loadingScreen.style.display = 'none';
}

window.openWaitModal = function(message) {
    const modal = document.getElementById('wait-modal');
    if (modal) {
        const msgElement = modal.querySelector('p');
        if (msgElement && message) msgElement.innerText = message;
        modal.style.display = 'flex';
    } else if (message) {
        alert(message);
    }
}

window.closeWaitModal = function() {
    const modal = document.getElementById('wait-modal');
    if (modal) modal.style.display = 'none';
}

// ==========================================
// 🎯 رادار تحديد مدة المباراة الذكي
// ==========================================
function getMatchDuration(leagueName) {
    if (!leagueName) return 120; // التوقيت الافتراضي للمباريات العادية
    const name = leagueName.toLowerCase();
    
    // كلمات تدل على إمكانية وجود أشواط إضافية (بما فيها الربع والنصف)
    const knockoutKeywords = ['كأس', 'نهائي', 'سوبر', 'cup', 'final', 'super', 'كوبا', 'خروج المغلوب', 'playoff', 'ربع', 'نصف', 'أبطال', 'champions'];
    
    const isKnockout = knockoutKeywords.some(keyword => name.includes(keyword));
    
    // 135 دقيقة للكؤوس والربع والنصف، و 100 دقيقة لمباريات الدوري العادية
    return isKnockout ? 140 : 120; 
}

// تصحيح التوقيت الذكي لتجاهل أخطاء قاعدة البيانات والمسافات المخفية (مثل 12:00)
function matchStartDate(match) {
  if (match?.scheduledAt) {
    const scheduledDate = new Date(match.scheduledAt);
    if (!Number.isNaN(scheduledDate.getTime())) return scheduledDate;
  }

  if (match?.time && match.time !== 'مباشر الآن' && match.time.includes(':')) {
    // إزالة ^ و $ من البحث لكي نلتقط الوقت حتى لو كان محاطاً بمسافات مخفية
    const timeMatch = String(match.time).match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      let hour = Number(timeMatch[1]);
      const minute = Number(timeMatch[2]);
      
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
    }
  }

  return null;
}

function liveMinuteText(match, matchDate) {
  const explicit = Number(match.liveMinute);
  if (Number.isFinite(explicit) && explicit >= 0) return `${Math.round(explicit)}'`;
  if (!matchDate || Number.isNaN(matchDate.getTime())) return 'مباشر';
  const minutes = Math.max(0, Math.min(130, Math.floor((Date.now() - matchDate.getTime()) / 60000)));
  return `${minutes}'`;
}

function cardsTotal(cards) {
  if (typeof cards === 'number') return Number.isFinite(cards) ? cards : 0;
  if (!cards || typeof cards !== 'object') return 0;
  const home = Number(cards.home ?? cards.homeTeam ?? cards.local ?? 0);
  const away = Number(cards.away ?? cards.awayTeam ?? cards.visitor ?? 0);
  return (Number.isFinite(home) ? home : 0) + (Number.isFinite(away) ? away : 0);
}

function cardsSide(cards, side) {
  if (!cards || typeof cards !== 'object') return 0;
  const value = side === 'home'
    ? Number(cards.home ?? cards.homeTeam ?? cards.local ?? 0)
    : Number(cards.away ?? cards.awayTeam ?? cards.visitor ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function renderLiveData(match, matchDate, isLive) {
  if (!isLive && match.playbackState !== 'ended') return '';
  const score = match.score && match.score !== 'VS' ? match.score : '0 - 0';
  const goals = Array.isArray(match.goals) ? match.goals.filter((goal) => goal?.player).slice(0, 4) : [];
  const minute = match.playbackState === 'ended' ? 'نهاية المباراة' : liveMinuteText(match, matchDate);
  const yellowHome = cardsSide(match.yellowCards, 'home');
  const yellowAway = cardsSide(match.yellowCards, 'away');
  const redHome = cardsSide(match.redCards, 'home');
  const redAway = cardsSide(match.redCards, 'away');
  return `
    <div class="live-data-strip" aria-label="بيانات المباراة الحية">
      <span class="live-stat"><i class="fas fa-stopwatch" aria-hidden="true"></i>${minute}</span>
      <span class="live-stat live-stat-score">${score}</span>
      <span class="live-stat"><span class="card-dot yellow"></span>${cardsTotal(match.yellowCards)}</span>
      <span class="live-stat"><span class="card-dot red"></span>${cardsTotal(match.redCards)}</span>
    </div>
    <div class="live-detail-panel" aria-label="تفاصيل مباشرة">
      <div>
        <small>الدقيقة</small>
        <strong>${minute}</strong>
      </div>
      <div>
        <small>الصفراء</small>
        <strong><span class="card-dot yellow"></span>${yellowHome} - ${yellowAway}</strong>
      </div>
      <div>
        <small>الحمراء</small>
        <strong><span class="card-dot red"></span>${redHome} - ${redAway}</strong>
      </div>
    </div>
    ${goals.length ? `
      <div class="match-scorers" aria-label="مسجلو الأهداف">
        ${goals.map((goal) => `<span><i class="fas fa-futbol" aria-hidden="true"></i>${goal.minute ? `${goal.minute}' ` : ''}${goal.player}</span>`).join('')}
      </div>
    ` : ''}
  `;
}

function renderMatch(match) {
  if (!match || !match.homeTeam || !match.awayTeam) return '';

  const { homeTeam, awayTeam } = match;
  const homeTeamName = homeTeam.name;
  const awayTeamName = awayTeam.name;
  const homeLogo = homeTeam.logo || 'assets/images/default-logo.jpg';
  const awayLogo = awayTeam.logo || 'assets/images/default-logo.jpg';
  const matchId = `${homeTeamName}_vs_${awayTeamName}`
    .toLocaleLowerCase('ar').trim().replace(/\s+/g, '_');
  const stableId = match.matchId || match.match_id || `${matchId}-${match.scheduledAt?.slice(0, 10) || 'undated'}`;
  const publicWatchId = opaqueWatchId(stableId);
  
  let watchUrl = `${PLAYER_ORIGIN}${PLAYER_PATH}?m=${encodeURIComponent(publicWatchId)}`;

  // ==========================================
  // 🚀 الإصلاح الجذري لمشكلة منتصف الليل والتوقيت
  // ==========================================
  const now = new Date();
  let matchDate = null;

  try {
      if (typeof matchStartDate === 'function') {
          matchDate = matchStartDate(match);
      }
      if (!matchDate && match.scheduledAt) {
          matchDate = new Date(match.scheduledAt);
      }
  } catch (e) {}
  
  let diffMins;
  // إذا كان الوقت سليماً وقابلاً للقراءة، نحسب الفارق
  if (matchDate && !isNaN(matchDate.getTime())) {
      diffMins = (matchDate - now) / 60000;
  } else if (match.time === 'مباشر الآن' || match.time === 'جاري الآن') {
      diffMins = 0;
  } else {
      // 🛡️ الحماية: إذا فشل النظام في معرفة الوقت (بسبب تغيير اليوم)،
      // نعتبر المباراة بعيدة جداً (9999 دقيقة) كي لا تفتح بالخطأ أبداً!
      diffMins = 9999; 
  }

  const hasData = match.sourceReady === true && match.playbackState === 'live';

  // ⏱️ حساب مدة المباراة بذكاء حسب البطولة
  const matchDuration = typeof getMatchDuration === 'function' ? getMatchDuration(match.league) : 120;
  const sourceStatus = String(match.status || match.state || match.matchStatus || '').toLowerCase();
  const isEnded = /result|finished|ended|full.?time|انته/.test(sourceStatus) || diffMins < -matchDuration;
  const isTimeAllowed = !isEnded && diffMins <= 20 && diffMins >= -matchDuration;
  const isLive = !isEnded && (match.isLive === true || (diffMins <= 0 && diffMins >= -matchDuration));
  const isSoon = diffMins > 0 && diffMins <= 60; 

  let timeText = match.time;
  
  if (match.time !== 'مباشر الآن' && match.time !== 'تحدد لاحقا') {
      if (matchDate && !isNaN(matchDate.getTime())) {
          timeText = matchDate.toLocaleTimeString('ar-EG-u-nu-latn', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
          });
      }
  }

  let statusBadge = '';
  let matchStatusClass = '';
  
  let hrefAttribute = `href="javascript:void(0)"`;
  let clickAction = `onclick="openWaitModal('عذراً، رابط البث سيفتح قبل بداية المباراة بـ 20 دقيقة.')"`;
  let isClickableClass = 'not-clickable';
  let topBadge = '';

  // ==========================================
  // 🛡️ منطق الشارات السليم للمباريات القادمة والمنتهية
  // ==========================================
  if (hasData) {
      if (isTimeAllowed) {
          hrefAttribute = `href="${watchUrl}" data-secure-match-id="${encodeURIComponent(stableId)}"`;
          clickAction = '';
          isClickableClass = 'clickable';
       } else if (isEnded) {
           // 🛑 المباراة انتهت بالفعل
           clickAction = '';
           statusBadge = '<span class="live-badge ended">انتهت</span>';
           timeText = match.score && match.score !== 'VS' ? `<span class="live-score">${match.score}</span>` : 'انتهت';
      } else {
          // ⏳ المباراة قادمة ولم يحن وقت البث
           clickAction = `onclick="openWaitModal('عذراً، رابط البث سيفتح قبل بداية المباراة بـ 20 دقيقة.')"`;
          if (diffMins > 0 && diffMins <= 60) {
              topBadge = '<span class="no-stream-badge" style="background: #e67e22; color: #fff;">يفتح قريباً</span>';
          } else {
              topBadge = ''; 
          }
      }
  } else {
      // إذا لم يكن هناك بيانات بث
       if (isEnded) {
           statusBadge = '<span class="live-badge ended">انتهت</span>';
           timeText = match.score && match.score !== 'VS' ? `<span class="live-score">${match.score}</span>` : 'انتهت';
           topBadge = '';
      } else {
          topBadge = '<span class="no-stream-badge">غير جاهز الان</span>';
      }
  }

  if (isEnded) {
      matchStatusClass = 'is-ended';
  } else if (isSoon) {
      timeText = '<span class="soon-text-blink">ستبدأ قريباً</span>';
      statusBadge = '<span class="live-badge soon">قريباً</span>';
  } else if (isLive) {
      statusBadge = '<span class="live-badge live">جاري الآن</span>';
      matchStatusClass = 'is-live';
      if (match.score && match.score.includes('-')) {
          timeText = `<span class="live-score">${match.score}</span>`;
      }
  }

  const matchDetailsHTML = `
    ${match.commentator ? `
      <div class="match-detail-item">
        <i class="fas fa-microphone-alt" aria-hidden="true"></i>
        <span>${match.commentator}</span>
      </div>
    ` : ''}
  `;

  return `
    <a ${hrefAttribute} ${clickAction} class="match-card-link ${isClickableClass}">
      <article class="match-card ${matchStatusClass}" data-match-id="${publicWatchId}">
        ${topBadge}
        ${statusBadge}
        <div class="league-info"><span>${match.league}</span></div>
        <div class="teams">
          <div class="team">
            <img src="${homeLogo}" alt="${homeTeamName}" loading="lazy" onerror="this.src='assets/images/default-logo.jpg';">
            <span class="team-name">${homeTeamName}</span>
          </div>
          <div class="match-info">
            <span class="score">${match.score}</span>
            <span class="time">${timeText}</span>
          </div>
          <div class="team">
            <img src="${awayLogo}" alt="${awayTeamName}" loading="lazy" onerror="this.src='assets/images/default-logo.jpg';">
            <span class="team-name">${awayTeamName}</span>
          </div>
        </div>
        ${renderLiveData(match, matchDate, isLive)}
        ${matchDetailsHTML.trim() ? `<div class="match-details-extra">${matchDetailsHTML}</div>` : ''}
      </article>
    </a>
  `;
}

function normalizeMatchName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/سان دي(?:ي)?[غج]و/gi, 'سان دييغو')
    .toLocaleLowerCase('ar');
}

function matchCanonicalKey(match) {
  const first = normalizeMatchName(match.homeTeam?.name || match.homeTeam);
  const second = normalizeMatchName(match.awayTeam?.name || match.awayTeam);
  const teams = [first, second].sort().join('|');
  const date = String(match.scheduledAt || '').slice(0, 10) || String(match.time || '');
  return `${teams}|${date}`;
}

function matchCompletenessScore(match) {
  let score = 0;
  if (match.sourceReady === true) score += 20;
  if (match.sourceAvailable === true) score += 10;
  if (match.playbackState === 'live') score += 14;
  if (match.playbackState === 'ended') score += 8;
  if (match.league && !/^league$/i.test(String(match.league).trim())) score += 8;
  if (match.homeTeam?.logo) score += 4;
  if (match.awayTeam?.logo) score += 4;
  if (match.score && match.score !== 'VS') score += 5;
  if (Number.isFinite(Number(match.liveMinute))) score += 3;
  if (cardsTotal(match.yellowCards) || cardsTotal(match.redCards)) score += 3;
  if (Array.isArray(match.goals) && match.goals.length) score += 2;
  return score;
}

function dedupeMatches(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const key = matchCanonicalKey(match);
    const current = byKey.get(key);
    if (!current || matchCompletenessScore(match) > matchCompletenessScore(current)) {
      byKey.set(key, match);
    }
  }
  return [...byKey.values()];
}

function matchIdentity(match) {
  return match.matchId || match.match_id || `${match.homeTeam.name}-${match.awayTeam.name}-${match.scheduledAt?.slice(0, 10) || 'undated'}`;
}

function opaqueWatchId(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash).padStart(10, '0');
}

async function openSecurePlayer(matchId) {
  if (!matchId) return;
  const playerTab = window.open('about:blank', '_blank');
  if (!playerTab) {
    window.openWaitModal?.('يرجى السماح بفتح تبويب جديد للمشاهدة.');
    return;
  }
  playerTab.opener = null;
  playerTab.document.title = 'جاري تجهيز المشغل';
  playerTab.document.body.textContent = 'جاري تجهيز المشغل...';
  playerTab.document.documentElement.dir = 'rtl';
  window.openWaitModal?.('جاري تجهيز المشغل الآمن...');
  let response;
  try {
    response = await fetch(`${STREAM_API_ORIGIN}/api/generate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      body: JSON.stringify({ matchId })
    });
  } catch {
    playerTab.close();
    window.openWaitModal?.('تعذر الاتصال بخادم البث. حاول مرة أخرى.');
    return;
  }

  if (!response.ok) {
    playerTab.close();
    const payload = await response.json().catch(() => ({}));
    const messages = {
      upcoming: 'سيُفتح البث قبل بداية المباراة بعشرين دقيقة.',
      ended: 'انتهت المباراة وتم إغلاق البث.',
      channel_unavailable: 'لم تُحدد القناة الناقلة بعد.',
      source_unavailable: 'مصدر القناة غير متوفر حالياً.'
    };
    window.openWaitModal?.(messages[payload.error] || 'البث غير متاح حالياً. حاول مرة أخرى لاحقاً.');
    return;
  }

  const { token } = await response.json().catch(() => ({}));
  if (!token) {
    playerTab.close();
    window.openWaitModal?.('لم يتمكن الخادم من إنشاء جلسة مشاهدة آمنة.');
    return;
  }
  window.closeWaitModal?.();
  if (!playerTab.closed) {
    playerTab.location.replace(`${PLAYER_ORIGIN}${PLAYER_PATH}?k=${encodeURIComponent(token)}`);
  }
}

function setupSecurePlayerLinks() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('.match-card-link.clickable[data-secure-match-id]');
    if (!link) return;
    event.preventDefault();
    const matchId = decodeURIComponent(link.dataset.secureMatchId || '');
    openSecurePlayer(matchId);
  });
}

function matchRenderSignature(match) {
  return [
    matchIdentity(match),
    match.scheduledAt || '',
    match.time || '',
    match.score || '',
    match.playbackState || '',
    match.sourceReady === true ? 'ready' : 'blocked',
    Number.isFinite(Number(match.liveMinute)) ? String(match.liveMinute) : '',
    JSON.stringify(match.yellowCards || null),
    JSON.stringify(match.redCards || null),
    JSON.stringify(match.goals || null),
    match.homeTeam?.logo || '',
    match.awayTeam?.logo || ''
  ].join('|');
}

function createMatchElement(match) {
  const template = document.createElement('template');
  template.innerHTML = renderMatch({ ...match, matchId: matchIdentity(match) }).trim();
  return template.content.firstElementChild;
}

function renderSection(container, matches, message) {
    if (!container) return;
  const nextMatches = matches || [];
  container.innerHTML = '';
  container.dataset.matchSignature = nextMatches.map(matchRenderSignature).join('||');
  if (!nextMatches.length) {
    container.innerHTML = `<div class="no-matches"><i class="fas fa-futbol"></i><p>${message}</p></div>`;
    return;
  }

  for (const match of nextMatches) {
    const element = createMatchElement(match);
    element.dataset.renderSignature = matchRenderSignature(match);
    container.appendChild(element);
  }
}

async function loadAndRenderMatches(options = {}) {
  const [rawTodayMatches, rawTomorrowMatches] = await Promise.all([
    getTodayMatches(options),
    getTomorrowMatches(options)
  ]);

  hideLoading();
  const allMatches = dedupeMatches([...rawTodayMatches, ...rawTomorrowMatches]
    .filter(match => match?.homeTeam?.name && match?.awayTeam?.name && matchStartDate(match)));
  const now = new Date();

  const trueTodayMatches = [];
  const trueTomorrowMatches = [];

  allMatches.forEach(match => {
      const day = getMoroccoDay(match.scheduledAt, new Date());
      if (day === 'today' || (day === 'yesterday' && match.playbackState === 'ended')) trueTodayMatches.push(match);
      else if (day === 'tomorrow') trueTomorrowMatches.push(match);
  });

  function sortMatches(a, b) {
      const diffA = (matchStartDate(a) - now) / 60000;
      const diffB = (matchStartDate(b) - now) / 60000;

      const hasLinkA = a.sourceReady === true && a.playbackState === 'live';
      const hasLinkB = b.sourceReady === true && b.playbackState === 'live';

      // ==========================================
      // 🚀 نظام الأوزان الجديد (الترتيب الذكي)
      // ==========================================
      const durationA = getMatchDuration(a.league);
      const durationB = getMatchDuration(b.league);

      const getTier = (diff, hasLink, duration) => {
          const isLive = diff <= 0 && diff >= -duration; 
          const isSoon = diff > 0 && diff <= 60;

          if (isLive && hasLink) return 1;  
          if (isSoon && hasLink) return 2;  
          if (isSoon && !hasLink) return 3; 
          if (isLive && !hasLink) return 4; 
          if (diff < -duration) return 6;        
          return 5;                         
      };

      const tierA = getTier(diffA, hasLinkA, durationA);
      const tierB = getTier(diffB, hasLinkB, durationB);

      // 1. الترتيب حسب الأولوية (الأوزان)
      if (tierA !== tierB) return tierA - tierB;

      // 2. الفرز الداخلي للمباريات التي تمتلك نفس الوزن
      if (tierA === 1 || tierA === 4) {
          // للمباريات الجارية: نعرض الأحدث (التي بدأت للتو) في القمة
          return matchStartDate(b) - matchStartDate(a);
      } else {
          // لبقية المباريات: نعرض الأقرب وقتاً في القمة
          return matchStartDate(a) - matchStartDate(b);
      }
  }

  trueTodayMatches.sort(sortMatches);
  trueTomorrowMatches.sort(sortMatches);

  renderSection(DOM.featuredContainer, trueTodayMatches, 'لا توجد مباريات جارية أو قادمة اليوم.');
  renderSection(DOM.broadcastContainer, trueTodayMatches, 'لا توجد مباريات هامة اليوم.');
  renderSection(DOM.todayContainer, trueTodayMatches, 'لا توجد مباريات اليوم.');
  renderSection(DOM.tomorrowContainer, trueTomorrowMatches, 'لا توجد مباريات غداً.');
}

function startLiveRefresh() {
    setInterval(() => {
        if (document.hidden) return;
        loadAndRenderMatches({ force: true }).catch(error => {
            console.warn('[MATCHES] live refresh failed:', error);
        });
    }, 30000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            loadAndRenderMatches({ force: true }).catch(error => {
                console.warn('[MATCHES] resume refresh failed:', error);
            });
        }
    });
}

function setupTabs() {
    const handleTabClick = (activeTab, inactiveTab, activeContainer, inactiveContainer) => {
        if (!activeTab || !inactiveTab || !activeContainer || !inactiveContainer) return;
        activeTab.classList.add('active');
        inactiveTab.classList.remove('active');
        activeContainer.classList.add('active');
        inactiveContainer.classList.remove('active');
        activeContainer.style.display = 'grid';
        inactiveContainer.style.display = 'none';
    };

    DOM.todayTab?.addEventListener('click', () => {
        handleTabClick(DOM.todayTab, DOM.tomorrowTab, DOM.todayContainer, DOM.tomorrowContainer);
    });

    DOM.tomorrowTab?.addEventListener('click', () => {
        handleTabClick(DOM.tomorrowTab, DOM.todayTab, DOM.tomorrowContainer, DOM.todayContainer);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupSecurePlayerLinks();
    loadAndRenderMatches().catch(error => {
        console.error("An error occurred while loading matches:", error);
        hideLoading();
    });
    startLiveRefresh();
});
