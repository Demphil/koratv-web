// assets/js/matches.js

import {
  getTodayMatches,
  getTomorrowMatches,
  getMoroccoWallClockNow,
  getMoroccoDay
} from './api.js';
import { streamLinks } from './streams.js';

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
  if (match?.time && match.time !== 'مباشر الآن' && match.time.includes(':')) {
    // إزالة ^ و $ من البحث لكي نلتقط الوقت حتى لو كان محاطاً بمسافات مخفية
    const timeMatch = String(match.time).match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      let hour = Number(timeMatch[1]);
      const minute = Number(timeMatch[2]);
      
      // تحويل 1 إلى 11 إلى نظام 24 ساعة (مسائي)
      if (hour >= 1 && hour <= 11) hour += 12;
      
      // التوقيت في الموقع هو توقيت السعودية (UTC+3)
      const utcHour = hour - 3;
      
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, minute, 0));
    }
  }

  // كخيار احتياطي
  if (match?.scheduledAt) {
    const scheduledDate = new Date(match.scheduledAt);
    if (!Number.isNaN(scheduledDate.getTime())) return scheduledDate;
  }

  return null;
}

function renderMatch(match) {
  if (!match || !match.homeTeam || !match.awayTeam) return '';

  const { homeTeam, awayTeam } = match;
  const homeTeamName = homeTeam.name;
  const awayTeamName = awayTeam.name;
  const homeLogo = homeTeam.logo || 'assets/images/default-logo.jpg';
  const awayLogo = awayTeam.logo || 'assets/images/default-logo.jpg';
  const matchSpecificKey = `${homeTeamName}-${awayTeamName}`;
  const matchId = `${homeTeamName}_vs_${awayTeamName}`
    .toLocaleLowerCase('ar').trim().replace(/\s+/g, '_');
  const stableId = match.matchId || match.match_id || `${matchId}-${match.scheduledAt?.slice(0, 10) || 'undated'}`;
  const publicWatchId = opaqueWatchId(stableId);
  
  const hasStreams = Array.isArray(match.streams) && match.streams.length > 0;
  const manualLink = streamLinks[match.channel] || streamLinks[matchSpecificKey];
  
  let watchUrl = `watch.html?id=${encodeURIComponent(publicWatchId)}`;

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

  const hasData = hasStreams || manualLink;

  // ⏱️ حساب مدة المباراة بذكاء حسب البطولة
  const matchDuration = typeof getMatchDuration === 'function' ? getMatchDuration(match.league) : 120;
  const isTimeAllowed = diffMins <= 25 && diffMins >= -matchDuration;
  const isLive = diffMins <= 0 && diffMins >= -matchDuration;
  const isSoon = diffMins > 0 && diffMins <= 60; 

  const channelName = typeof match.channel === 'string' && match.channel.trim()
    && !['غير محدد', 'Unknown', 'غير معروف'].includes(match.channel.trim())
    ? match.channel.trim()
    : 'تحدد لاحقاً';

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
  let clickAction = `onclick="openWaitModal('عذراً، رابط البث سيفتح قبل بداية المباراة بـ 25 دقيقة.')"`;
  let isClickableClass = 'not-clickable';
  let topBadge = '';

  // ==========================================
  // 🛡️ منطق الشارات السليم للمباريات القادمة والمنتهية
  // ==========================================
  if (hasData) {
      if (isTimeAllowed) {
          hrefAttribute = `href="${watchUrl}" target="_blank"`;
          clickAction = '';
          isClickableClass = 'clickable';
      } else if (diffMins < -matchDuration) {
          // 🛑 المباراة انتهت بالفعل
          clickAction = '';
          topBadge = ''; // إزالة أي شارة من المباريات المنتهية
      } else {
          // ⏳ المباراة قادمة ولم يحن وقت البث
          clickAction = `onclick="openWaitModal('عذراً، رابط البث سيفتح قبل بداية المباراة بـ 25 دقيقة.')"`;
          if (diffMins > 0 && diffMins <= 60) {
              topBadge = '<span class="no-stream-badge" style="background: #e67e22; color: #fff;">يفتح قريباً</span>';
          } else {
              topBadge = ''; 
          }
      }
  } else {
      // إذا لم يكن هناك بيانات بث
      if (diffMins < -matchDuration) {
          topBadge = ''; // لا تعرض "غير جاهز" لمباراة منتهية
      } else {
          topBadge = '<span class="no-stream-badge">غير جاهز الان</span>';
      }
  }

  if (isSoon) {
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
    <div class="match-detail-item">
      <i class="fas fa-tv" aria-hidden="true"></i>
      <span>${channelName}</span>
    </div>
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
        ${matchDetailsHTML.trim() ? `<div class="match-details-extra">${matchDetailsHTML}</div>` : ''}
      </article>
    </a>
  `;
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

function matchRenderSignature(match) {
  return [
    matchIdentity(match),
    match.scheduledAt || '',
    match.time || '',
    match.score || '',
    matchStartDate(match) && matchStartDate(match) <= new Date() ? 'live' : 'scheduled',
    match.channel || '',
    Array.isArray(match.streams) ? match.streams.map((stream) => stream.url || '').join(',') : '',
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

async function loadAndRenderMatches() {
  const [rawTodayMatches, rawTomorrowMatches] = await Promise.all([
    getTodayMatches(),
    getTomorrowMatches()
  ]);

  hideLoading();
  const allMatches = [...rawTodayMatches, ...rawTomorrowMatches]
    .filter(match => match?.homeTeam?.name && match?.awayTeam?.name && matchStartDate(match));
  const now = new Date();

  const trueTodayMatches = [];
  const trueTomorrowMatches = [];

  const seenMatches = new Set();
  allMatches.forEach(match => {
      const matchKey = match.matchId || match.match_id || `${match.homeTeam.name}-${match.awayTeam.name}-${match.scheduledAt?.slice(0, 10) || 'undated'}`;
      if (seenMatches.has(matchKey)) return;
      seenMatches.add(matchKey);
      
      const day = getMoroccoDay(match.scheduledAt, new Date());
      if (day === 'today') trueTodayMatches.push(match);
      else if (day === 'tomorrow') trueTomorrowMatches.push(match);
  });

  function sortMatches(a, b) {
      const diffA = (matchStartDate(a) - now) / 60000;
      const diffB = (matchStartDate(b) - now) / 60000;

      const fallbackA = streamLinks[a.channel] || streamLinks[`${a.homeTeam?.name}-${a.awayTeam?.name}`];
      const hasLinkA = (Array.isArray(a.streams) && a.streams.length > 0) || !!fallbackA;
    
      const fallbackB = streamLinks[b.channel] || streamLinks[`${b.homeTeam?.name}-${b.awayTeam?.name}`];
      const hasLinkB = (Array.isArray(b.streams) && b.streams.length > 0) || !!fallbackB;

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

function setupTabs() {
    const handleTabClick = (activeTab, inactiveTab, activeContainer, inactiveContainer) => {
        if (!activeTab || !inactiveTab || !activeContainer || !inactiveContainer) return;
        activeTab.classList.add('active');
        inactiveTab.classList.remove('active');
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
    loadAndRenderMatches().catch(error => {
        console.error("An error occurred while loading matches:", error);
        hideLoading();
    });
});
