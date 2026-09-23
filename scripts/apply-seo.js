const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const siteUrl = "https://koratv.click";
const logoUrl = `${siteUrl}/assets/images/logo.png`;
const imageUrl = `${siteUrl}/assets/images/default-news.jpg`;
const today = new Date().toISOString().slice(0, 10);

const socials = [
  "https://www.tiktok.com/@koratv.click",
  "https://www.instagram.com/koratv.click",
  "https://www.youtube.com/@MaghribiTv-i5t",
];

const sharedKeywords =
  "كورة لايف, koora live, koratv, مباريات اليوم, بث مباشر, أخبار كرة القدم, القنوات الناقلة";

const streamPages = [
  {
    file: "index.html",
    slug: "",
    title: "كورة لايف | مباريات اليوم بث مباشر وجدول القنوات",
    h1: "كورة لايف | مباريات اليوم بث مباشر koratv Football",
    description:
      "تابع مباريات اليوم بث مباشر على كورة لايف مع جدول المواعيد، نتائج لحظية، أخبار كرة القدم، وتفاصيل القنوات الناقلة للبطولات العربية والعالمية.",
    intro:
      "تجمع كورة لايف روابط متابعة مباريات اليوم وجدول المواعيد والقنوات الناقلة في صفحة واحدة مهيأة للبحث السريع قبل بداية كل مباراة.",
    priority: "1.0",
    changefreq: "daily",
    featured: "بث مباشر مباريات اليوم",
  },
  {
    file: "yalla-shoot-today.html",
    slug: "yalla-shoot-today.html",
    title: "يلا شوت | مباريات اليوم بث مباشر على كورة لايف",
    h1: "يلا شوت | مباريات اليوم بث مباشر",
    description:
      "صفحة يلا شوت على كورة لايف تعرض أهم مباريات اليوم بث مباشر مع مواعيد دقيقة وروابط مشاهدة محدثة قبل انطلاق اللقاءات.",
    intro:
      "إذا كنت تبحث عن يلا شوت لمتابعة مباريات اليوم، فهذه الصفحة تجمع جدول المباريات وروابط المشاهدة المتاحة فور اقتراب موعد البث.",
    priority: "0.72",
    changefreq: "daily",
    featured: "مباريات يلا شوت اليوم",
  },
  {
    file: "kooracity.html",
    slug: "kooracity.html",
    title: "كورة سيتي | متابعة مباريات اليوم بث مباشر",
    h1: "كورة سيتي | مباريات اليوم بث مباشر",
    description:
      "تابع عبر كورة سيتي على koratv جدول مباريات اليوم، روابط البث المباشر، وأبرز أخبار كرة القدم العربية والعالمية في مكان واحد.",
    intro:
      "تساعدك صفحة كورة سيتي على الوصول السريع إلى مباريات اليوم وأخبار الكرة دون التنقل بين أكثر من مصدر.",
    priority: "0.72",
    changefreq: "daily",
    featured: "مباريات كورة سيتي",
  },
  {
    file: "yalla-shoot-hd.html",
    slug: "yalla-shoot-hd.html",
    title: "يلا شوت HD | بث مباريات اليوم بجودة عالية",
    h1: "يلا شوت HD | بث مباشر بجودة عالية",
    description:
      "شاهد مباريات اليوم عبر يلا شوت HD من كورة لايف مع روابط بث عالية الجودة، تفاصيل القنوات، وتحديثات فورية قبل بداية اللقاء.",
    intro:
      "تركز صفحة يلا شوت HD على تجربة مشاهدة واضحة للمباريات المهمة مع عرض القناة والموعد وحالة البث عند توفرها.",
    priority: "0.72",
    changefreq: "daily",
    featured: "مباريات HD اليوم",
  },
  {
    file: "yalla-live.html",
    slug: "yalla-live.html",
    title: "يلا لايف | بث مباشر وجدول مباريات اليوم",
    h1: "يلا لايف | بث مباشر مباريات اليوم",
    description:
      "يلا لايف من كورة لايف يوفر جدول مباريات اليوم وروابط البث المباشر للأندية والمنتخبات مع تحديثات مستمرة للقنوات الناقلة.",
    intro:
      "في صفحة يلا لايف ستجد المباريات الأقرب للبداية وروابط المشاهدة عند توفرها مع جدول مرتب لليوم والغد.",
    priority: "0.72",
    changefreq: "daily",
    featured: "مباريات يلا لايف",
  },
  {
    file: "koora-extra.html",
    slug: "koora-extra.html",
    title: "كورة اكسترا | أخبار ومباريات اليوم بث مباشر",
    h1: "كورة اكسترا | مباريات وأخبار كرة القدم",
    description:
      "كورة اكسترا على koratv تجمع مباريات اليوم بث مباشر مع أخبار الكرة، الانتقالات، ونتائج أبرز الدوريات العربية والأوروبية.",
    intro:
      "تقدم صفحة كورة اكسترا تجربة أوسع تجمع جدول البث مع الأخبار الرياضية الحديثة لتسهيل متابعة اليوم الكروي.",
    priority: "0.72",
    changefreq: "daily",
    featured: "كورة اكسترا اليوم",
  },
  {
    file: "yall-extra.html",
    slug: "yall-extra.html",
    title: "يلا اكسترا | مباريات اليوم بث مباشر على كورة لايف",
    h1: "يلا اكسترا | بث مباشر مباريات اليوم",
    description:
      "يلا اكسترا على koratv تعرض مباريات اليوم بث مباشر مع مواعيد اللقاءات، القنوات الناقلة، وروابط المشاهدة قبل الانطلاق.",
    intro:
      "صفحة يلا اكسترا تمنح الزائر نافذة إضافية لمتابعة مباريات اليوم وروابط البث المباشر داخل شبكة كورة لايف.",
    priority: "0.7",
    changefreq: "daily",
    featured: "يلا اكسترا مباريات اليوم",
  },
  {
    file: "yalla-shoot-tv.html",
    slug: "yalla-shoot-tv.html",
    title: "يلا شوت TV | قنوات ناقلة وبث مباشر للمباريات",
    h1: "يلا شوت TV | القنوات الناقلة والبث المباشر",
    description:
      "اكتشف عبر يلا شوت TV مواعيد مباريات اليوم والقنوات الناقلة وروابط البث المباشر المحدثة قبل بداية كل مباراة.",
    intro:
      "هذه الصفحة موجهة لمن يبحث عن القناة الناقلة أولا، مع عرض روابط المشاهدة عندما تصبح المباراة قريبة من الانطلاق.",
    priority: "0.72",
    changefreq: "daily",
    featured: "قنوات مباريات اليوم",
  },
  {
    file: "sir-tv.html",
    slug: "sir-tv.html",
    title: "سير تيفي | مشاهدة مباريات اليوم على كورة لايف",
    h1: "سير تيفي | مشاهدة مباريات اليوم",
    description:
      "صفحة سير تيفي توفر متابعة مباريات اليوم بث مباشر، مواعيد اللقاءات، وتفاصيل القنوات الناقلة عبر كورة لايف.",
    intro:
      "سير تيفي صفحة بديلة داخل koratv لمتابعة جدول المباريات وروابط المشاهدة المحدثة للمواجهات المهمة.",
    priority: "0.7",
    changefreq: "daily",
    featured: "سير تيفي مباريات اليوم",
  },
  {
    file: "kora-online.html",
    slug: "kora-online.html",
    title: "كورة أون لاين | بث مباريات اليوم بدون تعقيد",
    h1: "كورة أون لاين | بث مباشر مباريات اليوم",
    description:
      "كورة أون لاين تعرض مباريات اليوم بث مباشر بطريقة منظمة مع نتائج لحظية، جدول القنوات، وروابط مشاهدة تعمل قبل بداية اللقاء.",
    intro:
      "توفر صفحة كورة أون لاين مدخلا مباشرا لمباريات اليوم لعشاق المتابعة السريعة من الهاتف أو الكمبيوتر.",
    priority: "0.7",
    changefreq: "daily",
    featured: "كورة أون لاين اليوم",
  },
  {
    file: "yacine-tv.html",
    slug: "yacine-tv.html",
    title: "ياسين تيفي | جدول المباريات والقنوات الناقلة",
    h1: "ياسين تيفي | مباريات اليوم والقنوات الناقلة",
    description:
      "تابع عبر ياسين تيفي على كورة لايف جدول مباريات اليوم والقنوات الناقلة وروابط البث المباشر للبطولات العربية والعالمية.",
    intro:
      "صفحة ياسين تيفي تساعدك على معرفة موعد المباراة والقناة الناقلة مع روابط البث عند توفرها داخل koratv.",
    priority: "0.7",
    changefreq: "daily",
    featured: "ياسين تيفي مباريات اليوم",
  },
  {
    file: "livehd7.html",
    slug: "livehd7.html",
    title: "LiveHD7 | بث مباريات اليوم بجودة HD",
    h1: "LiveHD7 | بث مباشر مباريات اليوم HD",
    description:
      "LiveHD7 على كورة لايف يقدم روابط بث مباريات اليوم بجودة HD مع جدول المواعيد وأخبار كرة القدم والقنوات الناقلة.",
    intro:
      "تجمع صفحة LiveHD7 بين جدول المباريات وروابط المشاهدة عالية الجودة عندما تكون متاحة قبل بداية البث.",
    priority: "0.7",
    changefreq: "daily",
    featured: "LiveHD7 مباريات اليوم",
  },
  {
    file: "buzkora.html",
    slug: "buzkora.html",
    title: "بوز كورة | مباريات اليوم بث مباشر وأخبار الكرة",
    h1: "بوز كورة | مباريات اليوم وأخبار كرة القدم",
    description:
      "بوز كورة من koratv يجمع مباريات اليوم بث مباشر مع آخر أخبار كرة القدم ونتائج البطولات المحلية والعالمية.",
    intro:
      "صفحة بوز كورة مناسبة لمن يريد متابعة الأخبار والمباريات في نفس المكان مع روابط داخلية واضحة لبقية صفحات كورة لايف.",
    priority: "0.7",
    changefreq: "daily",
    featured: "بوز كورة مباريات اليوم",
  },
  {
    file: "syria-live-tv.html",
    slug: "syria-live-tv.html",
    title: "سوريا لايف | بث مباشر للمباريات العربية والعالمية",
    h1: "سوريا لايف | مباريات اليوم بث مباشر",
    description:
      "سوريا لايف على كورة لايف تعرض مباريات اليوم العربية والعالمية بث مباشر مع تفاصيل القنوات، المواعيد، وروابط المشاهدة.",
    intro:
      "تمنحك صفحة سوريا لايف وصولا سريعا إلى مباريات اليوم المهمة عربيا وعالميا مع جدول مبسط وروابط محدثة.",
    priority: "0.7",
    changefreq: "daily",
    featured: "سوريا لايف مباريات اليوم",
  },
];

const useCasePages = [
  {
    dir: "at-work",
    title: "بث مباشر للمباريات في العمل | كورة لايف",
    h1: "بث مباشر للمباريات في العمل",
    description:
      "تابع مباريات اليوم من المكتب أو مكان العمل عبر صفحة خفيفة تعرض جدول المباريات وروابط البث المباشر المتاحة قبل البداية.",
    intro:
      "هذه الصفحة مهيأة للبحث عن بث مباريات اليوم أثناء العمل، مع تركيز على الجدول المختصر وروابط المشاهدة عند اقتراب وقت المباراة.",
    priority: "0.82",
  },
  {
    dir: "smart-tv",
    title: "تشغيل كورة لايف على الشاشة الذكية | Smart TV",
    h1: "تشغيل كورة لايف على الشاشة الذكية",
    description:
      "دليل سريع لمتابعة مباريات اليوم على شاشات Smart TV مع روابط كورة لايف وجدول القنوات الناقلة للمباريات المهمة.",
    intro:
      "صفحة Smart TV تساعد الزائر على فتح جدول المباريات وروابط المشاهدة من متصفح الشاشة الذكية بأقل خطوات ممكنة.",
    priority: "0.82",
  },
  {
    dir: "low-internet",
    title: "مشاهدة مباريات اليوم مع إنترنت ضعيف | كورة لايف",
    h1: "مشاهدة مباريات اليوم مع إنترنت ضعيف",
    description:
      "تابع مباريات اليوم عند ضعف الإنترنت من خلال صفحة خفيفة تعرض المواعيد وروابط البث المتاحة بدون عناصر زائدة.",
    intro:
      "تم تصميم هذه الصفحة لتكون خفيفة للزوار الذين يبحثون عن مباريات اليوم وروابط المشاهدة من شبكة محدودة أو باقة هاتف.",
    priority: "0.82",
  },
  {
    dir: "abroad",
    title: "مشاهدة المباريات العربية من الخارج | كورة لايف",
    h1: "مشاهدة المباريات العربية من الخارج",
    description:
      "تابع مباريات الأندية والمنتخبات العربية من الخارج عبر كورة لايف مع جدول مواعيد وروابط بث مباشر عند توفرها.",
    intro:
      "هذه الصفحة موجهة للمغتربين ومحبي الكرة العربية خارج المنطقة، وتجمع مباريات اليوم وروابط المتابعة في مكان واحد.",
    priority: "0.82",
  },
];

const allSitemapPages = [
  { loc: `${siteUrl}/`, priority: "1.0", changefreq: "daily" },
  { loc: `${siteUrl}/news.html`, priority: "0.9", changefreq: "daily" },
  ...useCasePages.map((page) => ({
    loc: `${siteUrl}/${page.dir}/`,
    priority: page.priority,
    changefreq: "weekly",
  })),
  ...streamPages
    .filter((page) => page.slug)
    .map((page) => ({
      loc: `${siteUrl}/${page.slug}`,
      priority: page.priority,
      changefreq: page.changefreq,
    })),
];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content, "utf8");
}

function pageUrl(page) {
  if (page.slug === "") return `${siteUrl}/`;
  if (page.slug) return `${siteUrl}/${page.slug}`;
  return `${siteUrl}/${page.dir}/`;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildSchema(page, type = "WebPage") {
  const url = pageUrl(page);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "koratv Football",
        alternateName: ["كورة لايف", "koora live", "koratv"],
        url: siteUrl,
        logo: {
          "@type": "ImageObject",
          url: logoUrl,
        },
        sameAs: socials,
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "كورة لايف",
        alternateName: "koratv Football",
        inLanguage: "ar",
        publisher: { "@id": `${siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": type,
        "@id": `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: "ar",
        isPartOf: { "@id": `${siteUrl}/#website` },
        publisher: { "@id": `${siteUrl}/#organization` },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: imageUrl,
        },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "SiteNavigationElement",
        "@id": `${siteUrl}/#site-navigation`,
        name: [
          "مباريات اليوم بث مباشر",
          "أخبار كرة القدم",
          "مباريات الغد",
          "القنوات الناقلة"
        ],
        url: [
          `${siteUrl}/`,
          `${siteUrl}/news.html`,
          `${siteUrl}/#tomorrow-matches`,
          `${siteUrl}/#featured-matches`
        ]
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "الرئيسية",
            item: `${siteUrl}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: page.h1 || page.title,
            item: url,
          },
        ],
      },
    ],
  };
}

function buildHead(page, options = {}) {
  const type = options.type || "WebPage";
  const url = pageUrl(page);
  const css = options.news
    ? ["/assets/css/news.css", "/assets/css/footer.css"]
    : ["/assets/css/matches.css", "/assets/css/footer.css"];
  const robots = options.noindex
    ? "noindex, follow"
    : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
  const extraVerification =
    page.file === "index.html"
      ? '    <meta name="ezoic-site-verification" content="45zSAuwQACheMQtQ6bGh81bIrm2Rsk">\n'
      : "";
  const adScripts = `
    <script>(function(s){s.dataset.zone='11639220',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
    <script>(function(s){s.dataset.zone='11638896',s.src='https://al5sm.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
    <script src="https://quge5.com/88/tag.min.js" data-zone="260051" async data-cfasync="false"></script>`;

  return `<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}">
    <meta name="keywords" content="${esc(`${sharedKeywords}, ${page.h1 || page.title}`)}">
    <meta name="author" content="koratv Team">
    <meta name="robots" content="${robots}">
    <meta name="theme-color" content="#1d3557">
${extraVerification}    <link rel="canonical" href="${url}">
    <link rel="alternate" hreflang="ar" href="${url}">
    <link rel="alternate" hreflang="x-default" href="${url}">
    <link rel="sitemap" type="application/xml" href="/sitemap.xml">
    <link rel="icon" href="/assets/images/favicon.ico" type="image/x-icon">
    <link rel="apple-touch-icon" href="/assets/images/logo.png">
    <link rel="preload" as="image" href="/assets/images/default-news.jpg">
    <link rel="dns-prefetch" href="//al5sm.com">
    <link rel="dns-prefetch" href="//nap5k.com">
    <link rel="dns-prefetch" href="//quge5.com">
    <meta property="og:site_name" content="koratv Football">
    <meta property="og:title" content="${esc(page.title)}">
    <meta property="og:description" content="${esc(page.description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:alt" content="koratv Football logo">
    <meta property="og:locale" content="ar_AR">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(page.title)}">
    <meta name="twitter:description" content="${esc(page.description)}">
    <meta name="twitter:image" content="${imageUrl}">
    <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
${css
  .map((href) => `    <link rel="stylesheet" href="${href}">`)
  .join("\n")}
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
${adScripts}
    <script type="application/ld+json">${JSON.stringify(buildSchema(page, type))}</script>
</head>`;
}

function updateHead(html, page, options = {}) {
  return html.replace(/<head>[\s\S]*?<\/head>/i, buildHead(page, options));
}

function updateHeaderTitle(html, page) {
  return html.replace(
    /<h1 class="header-title">[\s\S]*?<\/h1>/i,
    `<h1 class="header-title">${page.h1}</h1>`,
  );
}

function updateFeaturedTitle(html, page) {
  if (!page.featured) return html;
  return html.replace(
    /<h2 class="section-title"><i class="fas fa-moon"><\/i>[\s\S]*?<\/h2>/i,
    `<h2 class="section-title"><i class="fas fa-moon"></i>${page.featured}</h2>`,
  );
}

function stripGeneratedIntro(html) {
  return html.replace(/\s*<section class="seo-intro"[\s\S]*?<\/section>\s*/i, "\n");
}

function stripLegacyAds(html) {
  return html
    .replace(/\s*<script\b[^>]*src=["'][^"']*(?:ad-manager\.js|adsbygoogle\.js|revenuecpmgate\.com|fpyf8\.com|surefootedpause\.com|googletagmanager\.com|google-analytics\.com|doubleclick\.net)[^"']*["'][^>]*><\/script>\s*/gi, "\n")
    .replace(/\s*<ins\b[^>]*class=["'][^"']*adsbygoogle[^"']*["'][\s\S]*?<\/ins>\s*/gi, "\n")
    .replace(/\s*<script\b[^>]*>[\s\S]*?\(adsbygoogle\s*=\s*window\.adsbygoogle[^<]*<\/script>\s*/gi, "\n")
    .replace(/\s*<script\b[^>]*>[\s\S]*?(?:surefootedpause\.com|gtag\(|window\.dataLayer|googletagmanager\.com)[\s\S]*?<\/script>\s*/gi, "\n");
}

function hardenBlankTargets(html) {
  return html.replace(/target="_blank"(?!\s+rel=)/g, 'target="_blank" rel="noopener noreferrer"');
}

function updateStreamPage(page) {
  let html = read(page.file);
  html = updateHead(html, page);
  html = updateHeaderTitle(html, page);
  html = updateFeaturedTitle(html, page);
  html = stripGeneratedIntro(html);
  html = stripLegacyAds(html);
  html = hardenBlankTargets(html);
  write(page.file, html);
}

function updateNewsPage() {
  const page = {
    file: "news.html",
    slug: "news.html",
    title: "آخر أخبار كرة القدم اليوم | koratv Football",
    h1: "آخر أخبار كرة القدم اليوم",
    description:
      "تابع آخر أخبار كرة القدم اليوم على كورة لايف: انتقالات اللاعبين، نتائج المباريات، أخبار الدوريات، والقنوات الناقلة للأحداث المهمة.",
  };

  let html = read("news.html");
  html = updateHead(html, page, { news: true, type: "CollectionPage" });
  html = updateHeaderTitle(html, page);
  html = html.replace(/\s*<section class="news-hero"[\s\S]*?<\/section>\s*/i, "\n");
  html = html.replace(
    /<main class="news-main">\s*/i,
    `<main class="news-main">
        <section class="news-hero" aria-labelledby="news-hero-title">
            <h2 id="news-hero-title">أخبار كرة القدم العاجلة والمحدثة</h2>
            <p>نافذة أوسع لمتابعة أخبار الدوريات، الانتقالات، النتائج، وتصريحات ما قبل وبعد المباريات.</p>
        </section>
`,
  );
  html = html.replace(
    /<button id="load-more" class="load-more-btn">[\s\S]*?<\/button>/i,
    `<button id="load-more" class="load-more-btn">
                <i class="fas fa-plus"></i> تحميل المزيد من الأخبار
            </button>`,
  );
  html = stripLegacyAds(html);
  html = hardenBlankTargets(html);
  write("news.html", html);
}

function buildUseCasePage(page) {
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
${buildHead(page)}
<body>
    <header class="header">
        <div class="logo">
            <a href="/" aria-label="كورة لايف">
                <img src="/assets/images/logo.png" alt="koratv Football" loading="lazy" width="45" height="45">
            </a>
        </div>
        <h1 class="header-title">${page.h1}</h1>
        <nav class="nav" aria-label="التنقل الرئيسي">
            <ul>
                <li><a href="/news.html">أخبار الرياضة</a></li>
                <li><a href="/">مباريات اليوم بث مباشر</a></li>
            </ul>
        </nav>
    </header>

    <main class="matches-main">
        <section class="all-matches">
            <h2 class="section-title"><i class="fas fa-futbol"></i> جدول مباريات اليوم</h2>
            <div class="matches-tabs">
                <button id="today-tab" class="tab-btn active" data-tab="today">مباريات اليوم</button>
                <button id="tomorrow-tab" class="tab-btn" data-tab="tomorrow">مباريات الغد</button>
            </div>
            <div class="matches-grid">
                <div id="today-matches" class="tab-content active"></div>
                <div id="tomorrow-matches" class="tab-content" style="display: none;"></div>
            </div>
        </section>
    </main>

    <footer class="footer">
        <div class="footer-content">
            <div class="footer-logo"><a href="/" class="logo-text">كورة لايف</a></div>
            <div class="footer-links">
                <a href="/news.html"><i class="fas fa-newspaper"></i> أخبار الرياضة</a>
                <a href="/"><i class="fas fa-home"></i> مباريات اليوم بث مباشر</a>
            </div>
        </div>
        <div class="copyright">
            <p>Copyright © <span id="current-year"></span> koratv.Football - All rights reserved</p>
        </div>
    </footer>

    <div id="wait-modal" class="modal-overlay" onclick="closeWaitModal()">
        <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-icon"><i class="fas fa-clock"></i></div>
            <h3>عذراً، البث غير متاح الآن</h3>
            <p>سيتم تفعيل رابط المباراة تلقائياً <span class="highlight-time">قبل البداية بـ 10 دقائق</span></p>
            <button class="modal-close-btn" onclick="closeWaitModal()">حسناً، فهمت</button>
        </div>
    </div>

    <script>document.getElementById('current-year').textContent = new Date().getFullYear();</script>
    <script type="module" src="/assets/js/matches.js"></script>
</body>
</html>
`;

  const dir = path.join(root, page.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
}

function update404() {
  const page = {
    file: "404.html",
    slug: "404.html",
    title: "الصفحة غير موجودة | كورة لايف",
    h1: "الصفحة غير موجودة",
    description:
      "الصفحة المطلوبة غير موجودة في كورة لايف. عد إلى جدول مباريات اليوم أو صفحة أخبار كرة القدم.",
  };
  let html = read("404.html");
  html = updateHead(html, page, { noindex: true });
  html = stripLegacyAds(html);
  html = hardenBlankTargets(html);
  write("404.html", html);
}

function updateLegacyUsecase() {
  const page = {
    file: "usecase.html",
    slug: "usecase.html",
    title: "صفحة توجيه مباريات اليوم | كورة لايف",
    h1: "صفحة توجيه مباريات اليوم",
    description:
      "صفحة قديمة لتوجيه زوار كورة لايف إلى صفحات مباريات اليوم المخصصة حسب طريقة المشاهدة.",
  };
  let html = read("usecase.html");
  html = updateHead(html, page, { noindex: true });
  html = stripLegacyAds(html);
  html = hardenBlankTargets(html);
  write("usecase.html", html);
}

function updateRobots() {
  write(
    "robots.txt",
    `User-agent: *
Allow: /

# Google يحتاج CSS وJavaScript لفهم الصفحات كما يراها الزائر.
Allow: /assets/css/
Allow: /assets/js/
Allow: /assets/images/

Sitemap: ${siteUrl}/sitemap.xml
`,
  );
}

function updateSitemap() {
  const urls = allSitemapPages
    .map(
      (page) => `  <url>
    <loc>${page.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
    )
    .join("\n");

  write(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
  );
}

streamPages.forEach(updateStreamPage);
updateNewsPage();
useCasePages.forEach(buildUseCasePage);
update404();
updateLegacyUsecase();
updateRobots();
updateSitemap();

console.log("SEO files updated.");
