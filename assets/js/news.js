// assets/js/news.js

const CACHE_KEY = "koralive_rss_news_v5_hespress"; // كاش جديد تماماً
const CACHE_DURATION = 2 * 60 * 60 * 1000; 

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
    if (cachedData && cachedData.length > 0) return cachedData;
    
    try {
        if (elements.grid) {
            elements.grid.innerHTML = '<div class="loading-placeholder" style="grid-column: 1/-1; text-align:center; padding: 40px;"><i class="fas fa-spinner fa-spin"></i><p>جاري جلب أحدث الأخبار...</p></div>';
        }

        // استخدام 3 مصادر موثوقة ونشطة (RT + هسبريس رياضة + فرانس24)
        const sources = [
            'https://arabic.rt.com/rss/sport/',
            'https://www.hespress.com/sport/feed',
            'https://www.france24.com/ar/%D8%B1%D9%8A%D8%A7%D8%B6%D8%A9/rss'
        ];

        const requests = sources.map(url => 
            fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`).catch(() => null)
        );

        const responses = await Promise.all(requests);
        let allArticles = [];

        for (const res of responses) {
            if (res && res.ok) {
                const data = await res.json();
                if (data.items) allArticles = [...allArticles, ...data.items];
            }
        }

        // ترتيب من الأحدث للأقدم
        allArticles.sort((a, b) => new Date((b.pubDate||'').replace(/-/g, '/')) - new Date((a.pubDate||'').replace(/-/g, '/')));

        if (allArticles.length > 0) setCache(CACHE_KEY, allArticles);
        return allArticles;

    } catch (error) {
        if (elements.grid) elements.grid.innerHTML = '<p class="error-msg" style="grid-column: 1/-1; text-align:center;">عذراً، تعذر الاتصال بمزود الأخبار.</p>';
        return [];
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
        let breakingCount = state.filteredArticles.length >= 15 ? 10 : Math.floor(state.filteredArticles.length / 2);
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
    const articleUrl = sanitizeUrl(article.link);
    const imgUrl = sanitizeUrl(article.thumbnail || (article.enclosure && article.enclosure.link), 'assets/images/default-news.jpg');
    
    let badge = "عالمي";
    if (title.includes("سعودي") || title.includes("النصر") || title.includes("الهلال")) badge = "السعودية";
    if (title.includes("مصري") || title.includes("الأهلي") || title.includes("الزمالك")) badge = "مصر";
    if (title.includes("إسباني") || title.includes("ريال") || title.includes("برشلونة")) badge = "إسبانيا";
    if (title.includes("إنجليزي") || title.includes("سيتي") || title.includes("ليفربول")) badge = "إنجلترا";
    if (title.includes("مغرب") || title.includes("أسود") || title.includes("الركراكي") || title.includes("الرجاء") || title.includes("الوداد")) badge = "المغرب";

    const card = document.createElement('article');
    card.className = type === 'breaking' ? 'breaking-news-card' : 'news-card'; 
    
    card.innerHTML = `
        <div class="news-image-wrapper">
            <span class="news-category-badge">${escapeHTML(badge)}</span>
            <img src="${escapeAttribute(imgUrl)}" alt="${escapeAttribute(title)}" loading="lazy" onerror="this.src='assets/images/default-news.jpg'">
        </div>
        <div class="news-content">
            <h3 class="news-title">
                <a href="${escapeAttribute(articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(truncateText(title, 80))}</a>
            </h3>
            ${description ? `<p class="news-summary">${escapeHTML(truncateText(description, 100))}</p>` : ''}
            <div class="news-meta">
                <span><i class="far fa-clock"></i> ${escapeHTML(formatDate(article.pubDate))}</span>
                <a href="${escapeAttribute(articleUrl)}" target="_blank" rel="noopener noreferrer" class="read-more-link">اقرأ <i class="fas fa-arrow-left"></i></a>
            </div>
        </div>
    `;
    return card;
}

function applyFilter(keyword) {
    if (!keyword || keyword === 'كرة القدم' || keyword === 'all') {
        state.filteredArticles = [...state.allArticles];
    } else {
        const lowerKeyword = keyword.toLowerCase();
        state.filteredArticles = state.allArticles.filter(a => 
            (a.title && a.title.toLowerCase().includes(lowerKeyword)) || 
            (a.description && a.description.toLowerCase().includes(lowerKeyword))
        );
    }
    displayNews(false); 
}

function setupFilterClick(btn) {
    btn.addEventListener('click', () => {
        const siblings = btn.parentElement.querySelectorAll('button');
        siblings.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        let query = btn.dataset.category;
        if(query === 'football' || query === 'all') query = 'كرة القدم';
        if(query === 'spanish') query = 'إسباني';
        if(query === 'english') query = 'إنجليزي';
        if(query === 'saudi') query = 'سعودي';
        if(query === 'champions') query = 'أبطال';
        if(query === 'transfers') query = 'انتقال';

        applyFilter(query);
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
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
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
    const date = new Date(dateString.replace(/-/g, '/'));
    return date.toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function init() {
    state.allArticles = await fetchNews();
    state.filteredArticles = [...state.allArticles];
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
}

document.addEventListener('DOMContentLoaded', init);