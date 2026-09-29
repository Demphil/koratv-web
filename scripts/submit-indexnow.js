const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cnamePath = path.join(root, "CNAME");
const configuredHost = process.env.SITE_URL || (fs.existsSync(cnamePath)
  ? fs.readFileSync(cnamePath, "utf8").trim()
  : "koratv.click");
const siteHost = new URL(configuredHost.includes("://") ? configuredHost : `https://${configuredHost}`).hostname;
const key = "8f13b7e3fc9c709be30188a8675772ed";
const keyLocation = `https://${siteHost}/${key}.txt`;
const sitemapPath = process.env.INDEXNOW_SITEMAP_PATH || path.join(root, "sitemap.xml");

function getUrlsFromSitemap() {
  const xml = fs.readFileSync(sitemapPath, "utf8");
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
}

async function submitIndexNow() {
  const urlList = getUrlsFromSitemap();
  if (urlList.length === 0) {
    throw new Error("No URLs found in sitemap.xml");
  }
  const offsiteUrls = urlList.filter((url) => new URL(url).hostname !== siteHost);
  if (offsiteUrls.length > 0) {
    throw new Error(`Sitemap contains URLs outside configured host ${siteHost}`);
  }

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: siteHost,
      key,
      keyLocation,
      urlList,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`IndexNow returned HTTP ${response.status}`);

  console.log(`IndexNow submitted ${urlList.length} URLs. Status: ${response.status}`);
}

submitIndexNow().catch((error) => {
  console.error("IndexNow submission failed:", error.message);
  process.exitCode = 1;
});
