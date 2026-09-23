"use client";

import { useEffect, useState } from "react";

const API_KEY = "pub_157246adfe04454f85ed58e4c55f77b3";
const NEWS_URL = `https://newsdata.io/api/1/latest?apikey=${API_KEY}&size=6&removeduplicate=1&language=ar&category=sports&q=${encodeURIComponent("كرة القدم")}`;

const fallbackArticles = [
  {
    title: "تابع آخر أخبار كرة القدم قبل وأثناء المباريات",
    description: "ملخصات سريعة وأخبار محدثة حول القنوات، الفرق، وأهم المواجهات.",
    source_name: "koratv",
    link: "https://koratv.click/news.html",
    image_url: "https://koratv.click/assets/images/default-news.jpg"
  }
];

function truncateText(text, length) {
  if (!text) return "";
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function formatDate(dateString) {
  if (!dateString) return "الآن";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "الآن";
  return date.toLocaleDateString("ar-MA-u-nu-latn", {
    day: "numeric",
    month: "short"
  });
}

export default function WatchNews() {
  const [articles, setArticles] = useState(fallbackArticles);

  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      try {
        const response = await fetch(NEWS_URL);
        if (!response.ok) return;
        const data = await response.json();
        const nextArticles = Array.isArray(data.results) && data.results.length ? data.results : fallbackArticles;
        if (!cancelled) setArticles(nextArticles.slice(0, 6));
      } catch {
        if (!cancelled) setArticles(fallbackArticles);
      }
    }

    loadNews();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="watch-news-section" dir="rtl" aria-label="آخر أخبار كرة القدم">
      <div className="watch-news-header">
        <h2>آخر أخبار كرة القدم</h2>
        <a href="https://koratv.click/news.html" target="_blank" rel="noreferrer">عرض كل الأخبار</a>
      </div>
      <div className="watch-news-grid">
        {articles.map((article, index) => {
          const title = article.title || "خبر كرة قدم";
          const imageUrl = article.image_url || "https://koratv.click/assets/images/default-news.jpg";
          const sourceName = article.source_name || article.source_id || "مصدر رياضي";
          const link = article.link || "https://koratv.click/news.html";
          return (
            <article className="news-card watch-news-card" key={`${title}-${index}`}>
              <div className="news-image-wrapper">
                <span className="news-category-badge">عالمي</span>
                <img src={imageUrl} alt={title} loading="lazy" />
              </div>
              <div className="news-content">
                <h3 className="news-title">
                  <a href={link} target="_blank" rel="noreferrer">{truncateText(title, 82)}</a>
                </h3>
                <p className="news-summary">{truncateText(article.description || article.content || "", 110)}</p>
                <div className="news-meta">
                  <span>{formatDate(article.pubDate)}</span>
                  <span className="news-source">{truncateText(sourceName, 22)}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
