const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cnamePath = path.join(root, "CNAME");
const configuredHost = process.env.SITE_URL || (fs.existsSync(cnamePath)
  ? fs.readFileSync(cnamePath, "utf8").trim()
  : "koratv.click");
const siteUrl = new URL(configuredHost.includes("://") ? configuredHost : `https://${configuredHost}`).origin;
const pages = ["/", "/news.html"];
const failures = [];
const titles = new Set();
const descriptions = new Set();

for (const page of pages) {
  const file = page === "/" ? "index.html" : page.slice(1);
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const head = html.match(/<head[^>]*>[\s\S]*?<\/head>/i)?.[0] || "";
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = head.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1]?.trim();
  const canonical = head.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  const schemaText = head.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i)?.[1];

  if (!title) failures.push(`${file}: missing title`);
  if (!description) failures.push(`${file}: missing description`);
  if (canonical !== `${siteUrl}${page}`) failures.push(`${file}: canonical does not match configured site URL`);
  if (titles.has(title)) failures.push(`${file}: duplicate title`);
  if (descriptions.has(description)) failures.push(`${file}: duplicate description`);
  titles.add(title);
  descriptions.add(description);

  try {
    const schema = JSON.parse(schemaText);
    if (schema["@context"] !== "https://schema.org" || !Array.isArray(schema["@graph"])) {
      failures.push(`${file}: invalid structured data graph`);
    }
  } catch {
    failures.push(`${file}: invalid JSON-LD`);
  }
}

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const sitemapUrls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
const expectedUrls = pages.map((page) => `${siteUrl}${page}`);
if (JSON.stringify([...sitemapUrls].sort()) !== JSON.stringify([...expectedUrls].sort())) {
  failures.push("sitemap.xml must contain only the canonical homepage and news page");
}
if (!fs.readFileSync(path.join(root, "robots.txt"), "utf8").includes(`Sitemap: ${siteUrl}/sitemap.xml`)) {
  failures.push("robots.txt does not reference this site's sitemap");
}

for (const file of [
  "usecase.html",
  "at-work/index.html",
  "smart-tv/index.html",
  "low-internet/index.html",
  "abroad/index.html",
]) {
  const fullPath = path.join(root, file);
  if (fs.existsSync(fullPath) && !/<meta\s+name=["']robots["']\s+content=["']noindex, follow["']/i.test(fs.readFileSync(fullPath, "utf8"))) {
    failures.push(`${file}: duplicate/legacy page must be noindex`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`SEO configuration is consistent for ${siteUrl} (${pages.length} indexed pages).`);
