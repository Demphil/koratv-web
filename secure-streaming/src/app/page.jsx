import { absoluteUrl, SITE_NAME } from "../lib/seo";

export const metadata = {
  title: "koratv - Watch Live Football Matches Today",
  description: "Watch today's football matches live on koratv Football with updated match schedules, broadcast channels, and secure multi-quality streaming pages.",
  alternates: {
    canonical: absoluteUrl("/")
  },
  openGraph: {
    title: "koratv - Watch Live Football Matches Today",
    description: "Live football schedules, broadcast channels, and secure koratv match viewing pages.",
    url: absoluteUrl("/"),
    type: "website"
  }
};

export default function HomePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": SITE_NAME,
    "url": absoluteUrl("/"),
    "inLanguage": "ar",
    "description": metadata.description,
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${absoluteUrl("/")}#search?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };

  return (
    <main className="seo-home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="seo-home-card">
        <a className="header-logo seo-home-logo" href={absoluteUrl("/")} aria-label="koratv Football">
          <strong>koratv</strong><span>.football</span>
        </a>
        <h1>koratv Football - بث مباشر مباريات اليوم</h1>
        <p>
          تابع مباريات كرة القدم اليوم عبر صفحات مشاهدة آمنة، قنوات محدثة،
          وسيرفرات جودة متعددة تناسب سرعة اتصالك.
        </p>
        <a className="seo-home-link" href={absoluteUrl("/")}>العودة إلى الموقع الرئيسي</a>
      </section>
    </main>
  );
}
