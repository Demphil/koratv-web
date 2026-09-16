const fs = require("fs");
const path = require("path");
const axios = require("axios");

const root = path.resolve(__dirname, "..");
const siteHost = "koratv.click";
const key = "7fbee603f5d44620b6cf6cdff1cb2156";
const keyLocation = `https://${siteHost}/${key}.txt`;
const sitemapPath = path.join(root, "sitemap.xml");

function getUrlsFromSitemap() {
  const xml = fs.readFileSync(sitemapPath, "utf8");
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
}

async function submitIndexNow() {
  const urlList = getUrlsFromSitemap();
  if (urlList.length === 0) {
    throw new Error("No URLs found in sitemap.xml");
  }

  const response = await axios.post(
    "https://api.indexnow.org/indexnow",
    {
      host: siteHost,
      key,
      keyLocation,
      urlList,
    },
    {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 300,
    },
  );

  console.log(`IndexNow submitted ${urlList.length} URLs. Status: ${response.status}`);
}

submitIndexNow().catch((error) => {
  console.error("IndexNow submission failed:", error.message);
  process.exitCode = 1;
});
