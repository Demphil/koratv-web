// assets/js/news.js
import { newsImageCandidates } from './news-images.js?v=20261008-article-images';

const CACHE_KEY = "local_news_v6_internal";
const CACHE_DURATION = 15 * 60 * 1000;

const elements = {
    grid: document.getElementById('news-grid-container') || document.getElementById('sports-news'),
    breakingGrid: document.getElementById('breaking-news'), 
    searchInput: document.getElementById('news-search-input') || document.getElementById('news-search'),
    searchBtn: document.getElementById('search-btn'),
    filterBtns: document.querySelectorAll('.filter-btn'), 
    categoryBtns: document.querySelectorAll('.category-btn'), 
    loadMoreBtn: document.getElementById('load-more')
};

let state = {
    allArticles: [],       
    filteredArticles: [],  
    currentIndex: 0,       
    itemsPerPage: 9        
};

function setCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data: data }));
    } catch (e) {}
}

function getCache(key) {
    try {
        const cachedItem = localStorage.getItem(key);
        if (!cachedItem) return null;
        const { timestamp, data } = JSON.parse(cachedItem);
        if ((Date.now() - timestamp) > CACHE_DURATION) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch (e) { return null; }
}

async function fetchNews() {
    const cachedData = getCache(CACHE_KEY);
    if (Array.isArray(cachedData) && cachedData.length > 0) return cachedData;
    try {
        const response = await fetch('/news/feed.json', { signal: AbortSignal.timeout(8000), credentials: 'omit' });
        if (!response.ok) throw new Error('News snapshot unavailable');
        const data = await response.json();
        if (data.version !== 1 || !Array.isArray(data.articles)) throw new Error('Invalid news snapshot');
        const articles = data.articles.filter(article => {
            try {
                const url = new URL(article.path, window.location.origin);
                return url.origin === window.location.origin && /^\/news\/[^/]+\/$/.test(url.pathname);
            } catch { return false; }
        });
        if (articles.length) setCache(CACHE_KEY, articles);
        return articles.length ? articles : null;
    } catch {
        // Keep the server-rendered news visible when the local snapshot cannot load.
        return null;
    }
}

function displayNews(append = false) {
    if (!elements.grid) return;

    if (!append) {
        elements.grid.innerHTML = '';
        if (elements.breakingGrid) elements.breakingGrid.innerHTML = '';
        state.currentIndex = 0;
    }

    if (state.filteredArticles.length === 0) {
        elements.grid.innerHTML = '<p class="no-news" style="grid-column: 1/-1; text-align: center; color: #888;">لا توجد أخبار تطابق بحثك حالياً.</p>';
        updateLoadMoreBtn();
        return;
    }

    let itemsToRender = [];
    
    if (!append && elements.breakingGrid) {
        // حماية ذكية: إذا كانت الأخبار قليلة، لا تضعها كلها في العاجل!
        let breakingCount = Math.min(3, state.filteredArticles.length);
        breakingCount = breakingCount === 0 ? 1 : breakingCount; // على الأقل خبر واحد للعاجل

        const breaking = state.filteredArticles.slice(0, breakingCount);
        breaking.forEach(article => {
            elements.breakingGrid.appendChild(createNewsCard(article, 'breaking'));
        });
        state.currentIndex = breakingCount; 
    }

    itemsToRender = state.filteredArticles.slice(state.currentIndex, state.currentIndex + state.itemsPerPage);
    state.currentIndex += itemsToRender.length;

    itemsToRender.forEach(article => {
        elements.grid.appendChild(createNewsCard(article, 'standard'));
    });

    updateLoadMoreBtn();
}

function createNewsCard(article, type) {
    const title = article.title || 'تحديث رياضي';
    const description = stripHTML(article.description || article.content || '');
    const articleUrl = sanitizeUrl(article.path);
    const images = newsImageCandidates(article, window.location.origin, html => new DOMParser().parseFromString(html, 'text/html'));
    const imgUrl = images[0] || '';
    
    let badge = "عالمي";
    if (title.includes("سعودي") || title.includes("النصر") || title.includes("الهلال")) badge = "السعودية";
    if (title.includes("مصري") || title.includes("الأهلي") || title.includes("الزمالك")) badge = "مصر";
    if (title.includes("إسباني") || title.includes("ريال") || title.includes("برشلونة")) badge = "إسبانيا";
    if (title.includes("إنجليزي") || title.includes("سيتي") || title.includes("ليفربول")) badge = "إنجلترا";
    if (title.includes("مغرب") || title.includes("أسود") || title.includes("الركراكي") || title.includes("الرجاء") || title.includes("الوداد")) badge = "المغرب";

    const card = document.createElement('article');
    card.className = type === 'breaking' ? 'breaking-news-card' : 'news-card'; 
    
    card.innerHTML = `
        <a class="news-image-wrapper news-image-link" href="${escapeAttribute(articleUrl)}" tabindex="-1" aria-hidden="true">
            <span class="news-category-badge">${escapeHTML(badge)}</span>
            ${imgUrl ? `<img src="${escapeAttribute(imgUrl)}" alt="${escapeAttribute(title)}" loading="lazy" decoding="async" width="640" height="360" referrerpolicy="no-referrer">` : ''}
        </a>
        <div class="news-content">
            <h3 class="news-title">
                <a href="${escapeAttribute(articleUrl)}">${escapeHTML(truncateText(title, 80))}</a>
            </h3>
            ${description ? `<p class="news-summary">${escapeHTML(truncateText(description, 100))}</p>` : ''}
            <div class="news-meta">
                <span><i class="far fa-clock"></i> ${escapeHTML(formatDate(article.pubDate))}</span>
                <a href="${escapeAttribute(articleUrl)}" class="read-more-link">اقرأ <i class="fas fa-arrow-left"></i></a>
            </div>
        </div>
    `;
    const image = card.querySelector('.news-image-wrapper img');
    if (image) {
        let next = 1;
        image.addEventListener('error', () => {
            if (next < images.length) image.src = images[next++];
            else image.remove();
        });
    }
    return card;
}

const categoryTerms = {
    results: ['نتائج', 'نتيجة', 'فاز', 'score', 'result'],
    statistics: ['إحصائيات', 'احصائيات', 'أرقام', 'رقم', 'statistics'],
    fixtures: ['مواجهة', 'مواجهات', 'مباراة', 'مباريات', 'لقاء', 'match'],
    analysis: ['تحليل', 'تحليلات', 'قراءة فنية', 'analysis'],
    spanish: ['إسباني', 'اسبانيا', 'إسبانيا', 'ريال مدريد', 'برشلونة', 'فياريال', 'لاليغا'],
    english: ['إنجليزي', 'انجليزي', 'ليفربول', 'أرسنال', 'ارسنال', 'مانشستر', 'تشيلسي', 'برينتفورد'],
    saudi: ['سعودي', 'السعودية', 'الهلال', 'النصر', 'الاتحاد', 'الأهلي السعودي'],
    champions: ['دوري الأبطال', 'دوري أبطال أوروبا', 'دوري ابطال اوروبا', 'أوروبي', 'الجولة الأوروبية'],
    transfers: ['انتقال', 'تعاقد', 'صفقة', 'transfers']
};

function applyFilter(keyword) {
    state.filterWord = keyword || '';
    if (!keyword || keyword === 'كرة القدم' || keyword === 'all') {
        state.filteredArticles = [...state.allArticles];
    } else {
        const lowerKeyword = keyword.toLowerCase();
        const terms = categoryTerms[keyword] || [lowerKeyword];
        state.filteredArticles = state.allArticles.filter(article => {
            const searchable = [article.title, article.description, ...(article.tags || [])].join(' ').toLowerCase();
            return terms.some(term => searchable.includes(term.toLowerCase()));
        });
    }
    displayNews(false); 
}

function setupFilterClick(btn) {
    btn.addEventListener('click', () => {
        const siblings = btn.parentElement.querySelectorAll('button');
        siblings.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const aliases = {
            football: 'all',
            'كرة-القدم-الإسبانية': 'spanish',
            'كرة-القدم-الانجليزية': 'english',
            'دوري-ابطال-اوروبا': 'champions',
            'كرة-القدم-السعودية': 'saudi'
        };
        applyFilter(aliases[btn.dataset.category] || btn.dataset.category);
    });
}

function updateLoadMoreBtn() {
    if (elements.loadMoreBtn) {
        if (state.currentIndex < state.filteredArticles.length) {
            elements.loadMoreBtn.style.display = 'inline-flex';
            elements.loadMoreBtn.innerHTML = '<i class="fas fa-plus"></i> تحميل المزيد';
            elements.loadMoreBtn.disabled = false;
        } else {
            elements.loadMoreBtn.style.display = 'none';
        }
    }
}

function stripHTML(htmlStr) {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = htmlStr;
    return tmp.textContent || tmp.innerText || "";
}

function truncateText(text, length) {
    if (!text) return "";
    return text.length > length ? text.substring(0, length) + "..." : text;
}

function sanitizeUrl(url, fallback = '#') {
    if (!url) return fallback;
    try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.origin === window.location.origin && /^\/news\/[^/]+\/$/.test(parsed.pathname)) return parsed.href;
    } catch (e) {}
    return fallback;
}

function escapeHTML(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
    return escapeHTML(value).replaceAll('`', '&#096;');
}

function formatDate(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Casablanca', month: 'short', day: 'numeric', year: 'numeric' });
}

async function init() {
    const articles = await fetchNews();
    if (!articles) return;
    state.allArticles = articles;
    state.filteredArticles = [...articles];
    displayNews(false);

    const performSearch = () => applyFilter(elements.searchInput?.value.trim());
    elements.searchBtn?.addEventListener('click', performSearch);
    elements.searchInput?.addEventListener('keyup', (e) => { if (e.key === 'Enter') performSearch(); });
    elements.filterBtns?.forEach(btn => setupFilterClick(btn));
    elements.categoryBtns?.forEach(btn => setupFilterClick(btn));

    elements.loadMoreBtn?.addEventListener('click', () => {
        elements.loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري...';
        elements.loadMoreBtn.disabled = true;
        setTimeout(() => displayNews(true), 300); 
    });
    window.PublisherAdWindow?.register('news', {
        capture: () => ({ query: elements.searchInput?.value || '', filter: state.filterWord || '', count: state.currentIndex,
            active: [...elements.filterBtns, ...elements.categoryBtns].filter(btn => btn.classList.contains('active')).map(btn => btn.dataset.category) }),
        restore: saved => {
            if (!saved || typeof saved.query !== 'string' || saved.query.length > 1024 || typeof saved.filter !== 'string'
                || saved.filter.length > 1024 || !Number.isInteger(saved.count) || saved.count < 0 || saved.count > 500
                || !Array.isArray(saved.active) || saved.active.some(value => typeof value !== 'string' || value.length > 100)) return false;
            if (elements.searchInput) elements.searchInput.value = saved.query;
            for (const btn of [...elements.filterBtns, ...elements.categoryBtns]) btn.classList.toggle('active', saved.active.includes(btn.dataset.category));
            applyFilter(saved.filter);
            while (state.currentIndex < Math.min(saved.count, state.filteredArticles.length)) displayNews(true);
            return true;
        }
    });
}

document.addEventListener('DOMContentLoaded', init);
