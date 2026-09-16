// assets/js/watch.js
import { streamLinks } from './streams.js';

function makeMatchKey(homeTeam, awayTeam) {
  return `${homeTeam || ''}-${awayTeam || ''}`;
}

function normalizeMatchId(value) {
  return String(value || '').trim();
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

function streamFromUrl(url, label = 'سيرفر 1') {
  if (!url) return null;
  return {
    url,
    type: /\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : 'iframe',
    label
  };
}

async function fetchMatchById(matchId) {
  if (!matchId) return null;
  try {
    const response = await fetch(`/api/matches?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    const matches = Array.isArray(body.matches) ? body.matches : [];
    return matches.find((match) => {
      const id = normalizeMatchId(match.match_id || match.matchId || '');
      const fallbackId = `${match.homeTeam?.name || ''}-${match.awayTeam?.name || ''}-${match.scheduledAt?.slice(0, 10) || 'undated'}`;
      return opaqueWatchId(id || fallbackId) === matchId || id === matchId || decodeURIComponent(id) === matchId;
    }) || null;
  } catch (error) {
    console.error('تعذر جلب بيانات المباراة:', error);
    return null;
  }
}

function streamsFromMatch(match) {
  if (!match) return [];
  const directStreams = Array.isArray(match.streams)
    ? match.streams
        .map((item, index) => streamFromUrl(item.url || item.src, item.label || `سيرفر ${index + 1}`))
        .filter(Boolean)
    : [];

  if (directStreams.length) return directStreams;

  const homeName = typeof match.homeTeam === 'object' ? match.homeTeam.name : match.homeTeam;
  const awayName = typeof match.awayTeam === 'object' ? match.awayTeam.name : match.awayTeam;
  const channel = match.channel || match.channels?.[0] || '';
  const mapped = streamLinks[channel] || streamLinks[makeMatchKey(homeName, awayName)];
  return [streamFromUrl(mapped)].filter(Boolean);
}

document.addEventListener('DOMContentLoaded', async () => {
  const playerContainer = document.getElementById('player-container');
  const playerLoader = document.getElementById('player-loader');
  const serversContainer = document.getElementById('servers-container') || createServersContainer(playerContainer);

  if (!playerContainer || !playerLoader) return;

  const urlParams = new URLSearchParams(window.location.search);
  const matchId = normalizeMatchId(urlParams.get('id'));

  let streams = [];
  if (matchId) {
    streams = streamsFromMatch(await fetchMatchById(matchId));
  }

  if (streams.length === 0) {
    playerContainer.innerHTML = '<p class="error-message" style="color:#fff; text-align:center; padding: 40px;">عذراً، البث غير متوفر حالياً أو لم يبدأ بعد.</p>';
    if (playerLoader) playerLoader.style.display = 'none';
    loadWatchNews();
    return;
  }

  applyBaseCSS(playerContainer);
  renderServers(streams, playerContainer, playerLoader, serversContainer);
  loadWatchNews();
});

function createServersContainer(playerContainer) {
  const div = document.createElement('div');
  div.id = 'servers-container';
  div.style.display = 'flex';
  div.style.gap = '10px';
  div.style.marginBottom = '15px';
  div.style.flexWrap = 'wrap';
  div.style.justifyContent = 'center';
  playerContainer.parentNode.insertBefore(div, playerContainer);
  return div;
}

function applyBaseCSS(container) {
  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.backgroundColor = '#000';
  container.style.borderRadius = '12px';
  container.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
  container.style.overflow = 'hidden';
}

function renderServers(streams, playerContainer, playerLoader, serversContainer) {
  if (serversContainer) serversContainer.style.display = 'none';

  let topBar = document.getElementById('custom-top-bar');
  if (!topBar) {
    topBar = document.createElement('div');
    topBar.id = 'custom-top-bar';
    topBar.style.width = '100%';
    topBar.style.marginBottom = '15px';
    playerContainer.parentNode.insertBefore(topBar, playerContainer);
  }
  topBar.innerHTML = '';

  const barContent = document.createElement('div');
  barContent.style.display = 'flex';
  barContent.style.justifyContent = 'space-between';
  barContent.style.alignItems = 'center';
  barContent.style.width = '100%';
  barContent.style.backgroundColor = '#1e1e1e';
  barContent.style.padding = '10px 15px';
  barContent.style.borderRadius = '8px';
  barContent.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';
  barContent.style.boxSizing = 'border-box';

  const logoLink = document.createElement('a');
  logoLink.href = 'index.html';
  logoLink.style.display = 'flex';
  logoLink.style.alignItems = 'center';
  const logoImg = document.createElement('img');
  logoImg.src = 'assets/images/logo.png';
  logoImg.alt = 'KoraLive Football';
  logoImg.style.height = '35px';
  logoImg.style.width = 'auto';
  logoImg.onerror = function() { this.style.display = 'none'; };
  logoLink.appendChild(logoImg);

  const buttonsWrapper = document.createElement('div');
  buttonsWrapper.style.display = 'flex';
  buttonsWrapper.style.gap = '10px';
  buttonsWrapper.style.justifyContent = 'center';
  buttonsWrapper.style.flexWrap = 'wrap';
  buttonsWrapper.style.flex = '1';

  streams.forEach((stream, index) => {
    const btn = document.createElement('button');
    btn.innerText = stream.label || `سيرفر ${index + 1}`;
    btn.className = 'custom-srv-btn';
    btn.style.padding = '8px 16px';
    btn.style.cursor = 'pointer';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.backgroundColor = index === 0 ? '#e50914' : '#333';
    btn.style.color = '#fff';
    btn.style.fontFamily = 'inherit';
    btn.style.fontWeight = 'bold';
    btn.onclick = () => {
      document.querySelectorAll('.custom-srv-btn').forEach((button) => { button.style.backgroundColor = '#333'; });
      btn.style.backgroundColor = '#e50914';
      loadPlayer(stream, playerContainer, playerLoader);
    };
    buttonsWrapper.appendChild(btn);
  });

  const backBtn = document.createElement('a');
  backBtn.href = 'index.html';
  backBtn.innerHTML = 'عودة للمباريات &rarr;';
  backBtn.style.display = 'inline-flex';
  backBtn.style.alignItems = 'center';
  backBtn.style.color = '#ffffff';
  backBtn.style.textDecoration = 'none';
  backBtn.style.fontSize = '13px';
  backBtn.style.fontWeight = 'bold';
  backBtn.style.backgroundColor = '#e50914';
  backBtn.style.padding = '8px 12px';
  backBtn.style.borderRadius = '4px';
  backBtn.style.whiteSpace = 'nowrap';

  barContent.appendChild(logoLink);
  barContent.appendChild(buttonsWrapper);
  barContent.appendChild(backBtn);
  topBar.appendChild(barContent);

  if (streams.length > 1) {
    const noticeMsg = document.createElement('div');
    noticeMsg.style.color = '#ffcc00';
    noticeMsg.style.fontSize = '14px';
    noticeMsg.style.fontWeight = 'bold';
    noticeMsg.style.textAlign = 'center';
    noticeMsg.style.marginTop = '10px';
    noticeMsg.textContent = 'إذا لم يعمل البث أو كان يتقطع، يرجى تجربة سيرفر آخر.';
    topBar.appendChild(noticeMsg);
  }

  loadPlayer(streams[0], playerContainer, playerLoader);
}

function loadPlayer(stream, container, loader) {
  container.innerHTML = '';
  if (loader) {
    loader.style.display = 'block';
    container.appendChild(loader);
  }

  if (!stream || !stream.url) {
    if (loader) loader.style.display = 'none';
    container.innerHTML = '<p style="color:#ffcc00; text-align:center; padding: 60px; font-weight: bold; font-size: 16px;">عذراً، البث غير متوفر حالياً. يرجى المحاولة لاحقاً.</p>';
    return;
  }

  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.height = '0';
  container.style.paddingBottom = '56.25%';
  container.style.overflow = 'hidden';
  container.style.backgroundColor = '#000';
  container.style.borderRadius = '12px';

  // --- الحل القاطع: جلب الـ ID من الرابط مباشرة كبديل آمن ---
  const urlParams = new URLSearchParams(window.location.search);
  const matchId = urlParams.get('id') || 'bein1';
  
  let channelName = stream.url;
  if (channelName && channelName.includes('/')) {
    const parts = channelName.split('/').filter(Boolean);
    channelName = parts.pop() || matchId;
  }
  channelName = channelName ? channelName.replace('.m3u8', '').replace('.html', '').split('?')[0] : matchId;
  
  // إذا فشل الاستخراج لأي سبب، نستخدم الـ ID الموجود في الرابط لضمان عدم حدوث خطأ 403
  const finalTarget = (channelName && channelName.length > 1) ? channelName : matchId;

  const iframe = document.createElement('iframe');
  // تمرير القناة أو الـ ID بشكل صحيح ومباشر إلى جسر Cloudflare ومنه إلى سيرفر Oracle
  iframe.src = `https://withered-mud-4e52.koora-live.workers.dev/embed/${finalTarget}`;
  // ----------------------------------------------------------------

  iframe.frameBorder = '0';
  iframe.scrolling = 'no';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'no-referrer-when-downgrade';
  iframe.style.position = 'absolute';
  iframe.style.top = '0';
  iframe.style.left = '0';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.onload = () => { if (loader) loader.style.display = 'none'; };
  container.appendChild(iframe);

  const clickTrap = document.createElement('div');
  clickTrap.style.position = 'absolute';
  clickTrap.style.inset = '0';
  clickTrap.style.zIndex = '3';
  clickTrap.style.cursor = 'pointer';
  clickTrap.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clickTrap.remove();
  }, { once: true });
  container.appendChild(clickTrap);
}

async function loadWatchNews() {
  const newsContainer = document.getElementById('watch-news-container');
  if (!newsContainer) return;

  const CACHE_KEY = 'koralive_watch_news_v4';
  const CACHE_TIME = 2 * 60 * 60 * 1000;

  try {
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
      const { timestamp, articles } = JSON.parse(cachedData);
      if (Date.now() - timestamp < CACHE_TIME && articles?.length) {
        renderWatchNewsCards(articles.slice(0, 4), newsContainer);
        return;
      }
    }

    const feeds = [
      'https://arabic.rt.com/rss/sport/',
      'https://www.skynewsarabia.com/web/rss/sport'
    ];
    const responses = await Promise.all(feeds.map((feed) =>
      fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`).catch(() => null)
    ));
    const payloads = await Promise.all(responses.map((response) => response?.ok ? response.json() : { items: [] }));
    const allArticles = payloads.flatMap((payload) => payload.items || [])
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

    if (allArticles.length > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), articles: allArticles }));
      renderWatchNewsCards(allArticles.slice(0, 4), newsContainer);
    } else {
      newsContainer.innerHTML = '<p class="news-empty-msg" style="text-align:center; padding: 20px;">لا توجد أخبار حالياً.</p>';
    }
  } catch (error) {
    console.error('خطأ في جلب الأخبار لصفحة المشاهدة:', error);
    newsContainer.innerHTML = '<p class="news-empty-msg" style="text-align:center; padding: 20px;">حدث خطأ أثناء تحميل الأخبار.</p>';
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWatchNewsCards(articles, container) {
  container.innerHTML = articles.map((article) => {
    const title = article.title || 'أحدث الأخبار الرياضية';
    const articleUrl = article.link || '#';
    const imgUrl = article.thumbnail || article.enclosure?.link || 'assets/images/default-news.jpg';
    const dateStr = article.pubDate
      ? new Date(article.pubDate.replace(/-/g, '/')).toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const shortTitle = title.length > 60 ? `${title.substring(0, 60)}...` : title;

    return `
      <a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer" class="watch-news-card" style="display: flex; flex-direction: column; gap: 10px; text-decoration: none;">
        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 6px;" loading="lazy" onerror="this.src='assets/images/default-news.jpg'">
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <h4 style="margin: 0; font-size: 14px; line-height: 1.4; color: #fff;">${escapeHtml(shortTitle)}</h4>
          <span style="font-size: 12px; color: #888;">${escapeHtml(dateStr)}</span>
        </div>
      </a>
    `;
  }).join('');
}
