const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cname = path.join(root, "CNAME");
const configuredHost = process.env.SITE_URL || (fs.existsSync(cname)
  ? fs.readFileSync(cname, "utf8").trim()
  : "koratv.click");
const siteUrl = new URL(configuredHost.includes("://") ? configuredHost : `https://${configuredHost}`).origin;
const isFraja = new URL(siteUrl).hostname.endsWith("frajatv.fun");
const brand = isFraja ? "فرجة" : "KoraTV";
const logoPath = isFraja && fs.existsSync(path.join(root, "assets/images/fraja-logo.svg"))
  ? "/assets/images/fraja-logo.svg"
  : "/assets/images/logo.png";
const logoUrl = `${siteUrl}${logoPath}`;
const today = new Date().toISOString().slice(0, 10);

const pages = [
  {
    file: "index.html",
    path: "/",
    title: isFraja
      ? "جدول مباريات اليوم ونتائج كرة القدم | فرجة"
      : "نتائج ومواعيد مباريات كرة القدم اليوم | KoraTV",
    description: isFraja
      ? "اعرف مواعيد مباريات كرة القدم ونتائجها اليوم، مرتبة بحسب وقت البداية والبطولة وحالة المباراة، مع تحديثات للمتابعة من الهاتف."
      : "تابع نتائج وإحصاءات مباريات كرة القدم اليوم والغد، مع مواعيد البداية وحالة كل مباراة وترتيب واضح للبطولات بتوقيت المغرب.",
    h1: isFraja
      ? "مواعيد مباريات اليوم ونتائجها"
      : "نتائج وإحصاءات مباريات كرة القدم",
    type: "WebPage",
  },
  {
    file: "news.html",
    path: "/news.html",
    title: isFraja
      ? "مستجدات كرة القدم اليوم | أخبار فرجة"
      : "أخبار كرة القدم والبطولات | KoraTV",
    description: isFraja
      ? "تابع مستجدات كرة القدم والبطولات، وابحث في الأخبار حسب المسابقة أو المنتخب، مع روابط تعود إلى مصادر الخبر الأصلية."
      : "اقرأ أحدث مستجدات كرة القدم والبطولات، وابحث في الأخبار حسب المسابقة أو الفريق، مع روابط واضحة إلى المصادر الأصلية.",
    h1: isFraja ? "مستجدات كرة القدم" : "أخبار كرة القدم والبطولات",
    type: "CollectionPage",
  },
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function upsertTag(head, regex, tag) {
  return regex.test(head)
    ? head.replace(regex, tag)
    : head.replace(/<\/head>/i, `    ${tag}\n</head>`);
}

function meta(head, key, value, attribute = "name") {
  const escaped = escapeHtml(value);
  const matcher = new RegExp(`<meta\\s+${attribute}=["']${key}["'][^>]*>`, "i");
  return upsertTag(head, matcher, `<meta ${attribute}="${key}" content="${escaped}">`);
}

function pageSchema(page, url) {
  const websiteId = `${siteUrl}/#website`;
  const orgId = `${siteUrl}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: brand,
        url: siteUrl,
        logo: { "@type": "ImageObject", url: logoUrl },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: siteUrl,
        name: brand,
        inLanguage: "ar",
        publisher: { "@id": orgId },
      },
      {
        "@type": page.type,
        "@id": `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: "ar",
        isPartOf: { "@id": websiteId },
        publisher: { "@id": orgId },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: brand, item: `${siteUrl}/` },
          ...(page.path === "/" ? [] : [{
            "@type": "ListItem",
            position: 2,
            name: page.h1,
            item: url,
          }]),
        ],
      },
    ],
  };
}

function updatePage(page) {
  const file = path.join(root, page.file);
  let html = fs.readFileSync(file, "utf8");
  const url = `${siteUrl}${page.path}`;
  html = html.replace(/<head[^>]*>[\s\S]*?<\/head>/i, (headBlock) => {
    let head = headBlock;
    head = head.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`);
    head = meta(head, "description", page.description);
    head = meta(head, "robots", "index, follow, max-image-preview:large");
    head = meta(head, "og:site_name", brand, "property");
    head = meta(head, "og:title", page.title, "property");
    head = meta(head, "og:description", page.description, "property");
    head = meta(head, "og:type", "website", "property");
    head = meta(head, "og:url", url, "property");
    head = meta(head, "og:image", logoUrl, "property");
    head = meta(head, "og:locale", "ar_AR", "property");
    head = meta(head, "twitter:card", "summary", "name");
    head = meta(head, "twitter:title", page.title);
    head = meta(head, "twitter:description", page.description);
    head = meta(head, "twitter:image", logoUrl);
    head = head.replace(/\s*<meta\s+name=["']keywords["'][^>]*>/i, "");
    head = upsertTag(
      head,
      /<link\s+rel=["']canonical["'][^>]*>/i,
      `<link rel="canonical" href="${escapeHtml(url)}">`,
    );
    head = head.replace(/\s*<link\s+rel=["']alternate["'][^>]*hreflang=["'](?:ar|x-default)["'][^>]*>/gi, "");
    head = head.replace(/\s*<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
    return head.replace(
      /<\/head>/i,
      `    <link rel="alternate" hreflang="ar" href="${escapeHtml(url)}">\n    <link rel="alternate" hreflang="x-default" href="${escapeHtml(url)}">\n    <script type="application/ld+json">${JSON.stringify(pageSchema(page, url))}</script>\n</head>`,
    );
  });
  html = html.replace(
    /<h1\b([^>]*class=["'][^"']*header-title[^"']*["'][^>]*)>[\s\S]*?<\/h1>/i,
    `<h1$1>${escapeHtml(page.h1)}</h1>`,
  );
  fs.writeFileSync(file, html, "utf8");
}

function markNoindex(file) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) return;
  const html = fs.readFileSync(fullPath, "utf8").replace(/<head[^>]*>[\s\S]*?<\/head>/i, (head) => {
    const noindex = '<meta name="robots" content="noindex, follow">';
    return /<meta\s+name=["']robots["'][^>]*>/i.test(head)
      ? head.replace(/<meta\s+name=["']robots["'][^>]*>/i, noindex)
      : head.replace(/<\/head>/i, `    ${noindex}\n</head>`);
  });
  fs.writeFileSync(fullPath, html, "utf8");
}

for (const page of pages) updatePage(page);

for (const file of [
  "usecase.html",
  "at-work/index.html",
  "smart-tv/index.html",
  "low-internet/index.html",
  "abroad/index.html",
]) markNoindex(file);

fs.writeFileSync(
  path.join(root, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
  "utf8",
);

const sitemapUrls = pages.map((page) => {
  const url = escapeHtml(`${siteUrl}${page.path}`);
  return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`;
});
fs.writeFileSync(
  path.join(root, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.join("\n")}\n</urlset>\n`,
  "utf8",
);

console.log(`SEO metadata refreshed for ${siteUrl}; sitemap contains ${pages.length} canonical pages.`);
