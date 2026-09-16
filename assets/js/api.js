// --- 1. Cache Configuration ---

const CACHE_EXPIRY_MS = 2 * 60 * 1000;

const CACHE_KEY_TODAY = 'matches_cache_today_v2';

const CACHE_KEY_TOMORROW = 'matches_cache_tomorrow_v2';



function setCache(key, data) {
  // Match data must always reflect the current staging table.
  localStorage.removeItem(key);

}



function getCache(key) {
  localStorage.removeItem(key);
  return null;

}

for (const key of Object.keys(localStorage)) {
  if (key.startsWith('matches_cache_')) localStorage.removeItem(key);
}



export const MOROCCO_TIME_ZONE = 'Africa/Casablanca';

function moroccoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MOROCCO_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);

  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

export function getMoroccoWallClockNow() {
  const now = moroccoParts();
  return new Date(Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute, now.second));
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]));
}

function sourceDateParts(timeZone, dayOffset) {
  const today = zonedParts(new Date(), timeZone);
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localDateTimeToUtcIso(parts, timeZone) {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const zoned = zonedParts(new Date(localAsUtc), timeZone);
  const offsetAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return new Date(localAsUtc - (offsetAsUtc - localAsUtc)).toISOString();
}

export function getMoroccoDay(timestamp, reference = new Date()) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return null;
  const target = zonedParts(value, MOROCCO_TIME_ZONE);
  const current = zonedParts(reference, MOROCCO_TIME_ZONE);
  const difference = (Date.UTC(target.year, target.month - 1, target.day) - Date.UTC(current.year, current.month - 1, current.day)) / 86400000;
  return difference === 0 ? 'today' : difference === 1 ? 'tomorrow' : difference === -1 ? 'yesterday' : 'other';
}

function stableMatchId(homeTeam, awayTeam, scheduledAt = '') {
  const slug = (value) => String(value || '').trim().toLocaleLowerCase('ar')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const date = scheduledAt && /^\d{4}-\d{2}-\d{2}/.test(scheduledAt)
    ? scheduledAt.slice(0, 10)
    : 'undated';
  return `${slug(homeTeam)}-${slug(awayTeam)}-${date}`;
}

// --- 3. Database API ---

let stagingMatchesPromise = null;

function normalizeStagingMatch(match) {
  const homeName = typeof match.homeTeam === 'object' ? match.homeTeam.name : match.homeTeam;
  const awayName = typeof match.awayTeam === 'object' ? match.awayTeam.name : match.awayTeam;
  const scheduledAt = match.scheduledAt || '';
  const homeLogo = typeof match.homeTeam === 'object' ? match.homeTeam.logo : match.homeLogo;
  const awayLogo = typeof match.awayTeam === 'object' ? match.awayTeam.logo : match.awayLogo;
  if (!homeName || !awayName || !scheduledAt) return null;
  if (String(homeName).trim().toLocaleLowerCase('ar') === String(awayName).trim().toLocaleLowerCase('ar')) return null;
  const dateParts = zonedParts(new Date(scheduledAt), MOROCCO_TIME_ZONE);
  return {
    ...match,
    matchId: match.match_id || match.matchId || stableMatchId(homeName, awayName, scheduledAt),
    homeTeam: { name: homeName, logo: homeLogo || '' },
    awayTeam: { name: awayName, logo: awayLogo || '' },
    scheduledAt,
    time: match.time || `${String(dateParts.hour).padStart(2, '0')}:${String(dateParts.minute).padStart(2, '0')}`,
    rawMinutes: dateParts.hour * 60 + dateParts.minute,
    score: match.score || 'VS',
    league: match.league || '',
    channel: match.channel || match.channels?.[0] || 'تحدد لاحقاً',
    streams: Array.isArray(match.streams) ? match.streams : [],
    isLive: Boolean(match.isLive),
    commentator: match.commentator || ''
  };
}

async function getStagingMatches() {
  if (!stagingMatchesPromise) {
    stagingMatchesPromise = fetch(`/api/matches?t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        return response.json();
      })
      .then((body) => (Array.isArray(body.matches) ? body.matches : []).map(normalizeStagingMatch).filter(Boolean))
      .catch((error) => {
        stagingMatchesPromise = null;
        throw error;
      });
  }
  return stagingMatchesPromise;
}



export async function getTodayMatches() {
  try {
    const matches = await getStagingMatches();
    return matches.filter((match) => getMoroccoDay(match.scheduledAt) === 'today');
  } catch (error) {
    console.error(`Today matches fetch failed: ${error.message}`);
    return [];
  }
}

export async function getTomorrowMatches() {
  try {
    const matches = await getStagingMatches();
    return matches.filter((match) => getMoroccoDay(match.scheduledAt) === 'tomorrow');
  } catch (error) {
    console.error(`Tomorrow matches fetch failed: ${error.message}`);
    return [];
  }
}

const HOME_TEAM_SELECTORS = [
  '.team1 .TM_Name',
  '.team1 .team-name',
  '.match-team.team1 .team-name',
  '.match-team.team1 .TM_Name',
  '.right-team .team-name',
  '.TM1 .TM_Name',
  '.TM1 .team-name'
];

const AWAY_TEAM_SELECTORS = [
  '.MT_Team.TM2 .TM_Name',
  '[data-team="away"] .TM_Name',
  '[data-team="away"] .team-name',
  '.away-team .TM_Name',
  '.away-team .team-name',
  '.team-away .team-name',
  '.team2 .TM_Name',
  '.team2 .team-name',
  '.match-team.team2 .team-name',
  '.match-team.team2 .TM_Name',
  '.left-team .team-name',
  '.TM2 .TM_Name',
  '.TM2 .team-name'
];

function firstElement(root, selectors) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function textFrom(root, selectors, fallback = '') {
  return firstElement(root, selectors)?.textContent?.replace(/\s+/g, ' ').trim() || fallback;
}

function linkFrom(matchEl, sourceBaseUrl) {
  const anchor = [...matchEl.querySelectorAll('a[href]')].find((element) => {
    const href = element.getAttribute('href') || '';
    return href && href !== '#' && !href.toLowerCase().startsWith('javascript:');
  });
  if (!anchor) return '';
  return new URL(anchor.getAttribute('href'), sourceBaseUrl).href;
}

function scoreFrom(matchEl) {
  const scoreElements = matchEl.querySelectorAll('.MT_Result .RS-goals, .score-home, .score-away');
  if (scoreElements.length >= 2) {
    const scores = [...scoreElements].slice(0, 2).map((element) => parseInt(element.textContent.trim(), 10));
    if (scores.every((value) => !Number.isNaN(value))) return `${scores[0]} - ${scores[1]}`;
  }

  const scoreText = textFrom(matchEl, ['.MT_Result', '.match-score', '.score', '.result']);
  const scorePair = scoreText.match(/\b(\d+)\s*[-:]\s*(\d+)\b/);
  return scorePair ? `${scorePair[1]} - ${scorePair[2]}` : 'VS';
}

function liveStatusFrom(matchEl) {
  const className = typeof matchEl.className === 'string' ? matchEl.className : '';
  const statusText = textFrom(matchEl, ['.MT_Stat', '.match-status', '.status', '.date']);
  return /\blive\b|started|جارية|جاري|مباشر|الآن|الان/i.test(`${className} ${statusText}`);
}

function findMatchElements(doc) {
  for (const selector of MATCH_SELECTORS) {
    const elements = doc.querySelectorAll(selector);
    if (elements.length) return elements;
  }
  return [];
}

export function parseMatches(html, sourceBaseUrl = '', sourceTimeZone = 'Africa/Casablanca', sourceDayOffset = 0) {
  if (!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const matches = [];
  
  const matchElements = findMatchElements(doc);
  
  matchElements.forEach(matchEl => {
    try {
      // استخراج الفِرق
      const homeTeamEl = firstElement(matchEl, [
        '.right-team', '.team-home', '.team1', '.MT_Team.TM1', ...HOME_TEAM_SELECTORS
      ]);
      const awayTeamEl = firstElement(matchEl, [
        '.left-team', '.team-away', '.team2', '.MT_Team.TM2', ...AWAY_TEAM_SELECTORS
      ]);

      const homeTeamName = homeTeamEl ? homeTeamEl.textContent.trim() : '';
      const awayTeamName = awayTeamEl ? awayTeamEl.textContent.trim() : '';
      
      if (!homeTeamName || !awayTeamName) return;
      if (homeTeamName.trim() === awayTeamName.trim()) return;
      if (homeTeamName.normalize('NFKC').toLocaleLowerCase('ar') === awayTeamName.normalize('NFKC').toLocaleLowerCase('ar')) return;
      
      // استخراج رابط البث
      const matchLink = linkFrom(matchEl, sourceBaseUrl);
      if (!matchLink) return;
      
      // استخراج التوقيت أو النتيجة من منطقة المنتصف
      let score = 'VS';
      let originalTime = '';
      
      const centerEl = matchEl.querySelector('.match-center');
      const centerText = centerEl ? centerEl.textContent.trim() : '';

      // البحث عن التوقيت (يحتوي على نقطتين رأسيتين)
        const timeMatch = centerText.match(/(?:^|\D)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)/);
      if (timeMatch) {
          originalTime = `${timeMatch[1]}:${timeMatch[2]}`;
      }
      
      // البحث عن النتيجة (تحتوي على شرطة بين أرقام)
      const scoreMatch = centerText.match(/\d+\s*-\s*\d+/);
      if (scoreMatch) {
          score = scoreMatch[0];
      }

      const scheduledAt = timeMatch
        ? localDateTimeToUtcIso({ ...sourceDateParts(sourceTimeZone, sourceDayOffset), hour: Number(timeMatch[1]), minute: Number(timeMatch[2]) }, sourceTimeZone)
        : '';
      const moroccoTime = scheduledAt ? zonedParts(new Date(scheduledAt), MOROCCO_TIME_ZONE) : null;
      const timeData = moroccoTime
        ? { formatted: `${String(moroccoTime.hour).padStart(2, '0')}:${String(moroccoTime.minute).padStart(2, '0')}`, rawMinutes: moroccoTime.hour * 60 + moroccoTime.minute }
        : { formatted: '--:--', rawMinutes: 9999 };
      
      // استخراج معلومات القناة والمعلق والبطولة
      let channelFromSite = '';
      let commentator = '';
      let league = '';
      
      const infoEl = matchEl.querySelector('.match-info');
      if (infoEl) {
        // الموقع الجديد قد يضع البيانات داخل قوائم <ul> و <li> أو <div> مباشرة
        const infoItems = infoEl.querySelectorAll('li');
        if (infoItems.length >= 3) {
            channelFromSite = infoItems[0].textContent.trim();
            commentator = infoItems[1].textContent.trim();
            league = infoItems[infoItems.length - 1].textContent.trim();
        } else {
            // في حال عدم وجود قائمة، نسحب النص بالكامل كإسم للبطولة
            league = infoEl.textContent.replace(/\s+/g, ' ').trim();
        }
      }

      // القنوات تأتي من Supabase بعد حلها عبر Gemini، لا من ملف ثابت قديم.
      const finalChannel = 'تحدد لاحقاً';

      const homeLogo = extractImageUrl(homeTeamEl?.querySelector('img'), sourceBaseUrl);
      const awayLogo = extractImageUrl(awayTeamEl?.querySelector('img'), sourceBaseUrl);
      if (!isValidImageUrl(homeLogo) || !isValidImageUrl(awayLogo)) return;

      matches.push({
        homeTeam: { name: homeTeamName, logo: homeLogo },
        awayTeam: { name: awayTeamName, logo: awayLogo },
        time: timeData.formatted,
        rawMinutes: timeData.rawMinutes,
        scheduledAt,
        matchId: stableMatchId(homeTeamName, awayTeamName, scheduledAt),
        score: scoreFrom(matchEl),
        isLive: liveStatusFrom(matchEl),
        league,
        channel: finalChannel,
        commentator: commentator.includes('غير معروف') ? '' : commentator,
        matchLink: matchLink
      });
    } catch (e) {
        console.error("خطأ في معالجة مباراة:", e);
    }
  });
  return matches;
}


function extractImageUrl(imgElement, sourceBaseUrl) {

  if (!imgElement) return '';

  let src = imgElement.dataset.src || imgElement.getAttribute('src') || '';

  if (src.startsWith('http') || src.startsWith('//')) return src;

  src = src.startsWith('/') ? src.substring(1) : src;

  return new URL(src, sourceBaseUrl).href;

}

function isValidImageUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}
