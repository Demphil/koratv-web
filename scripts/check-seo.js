const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const htmlFiles = fs
  .readdirSync(root)
  .filter((file) => file.endsWith(".html") && !file.startsWith("pinterest-"));

for (const dir of ["at-work", "smart-tv", "low-internet", "abroad"]) {
  htmlFiles.push(path.join(dir, "index.html"));
}

const titles = new Map();
const descriptions = new Map();
const problems = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function add(map, key, file) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(file);
}

for (const file of htmlFiles) {
  const html = read(file);
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]?.trim();
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1]?.trim();
  const malformedSocial = html.match(/<meta\s+(property|name)="(?:og:title|twitter:title)"\s+content=[^"'][^>]*>/i);

  if (!title) problems.push(`${file}: missing title`);
  if (!description) problems.push(`${file}: missing meta description`);
  if (!canonical && !file.endsWith("404.html")) problems.push(`${file}: missing canonical`);
  if (malformedSocial) problems.push(`${file}: malformed social title tag`);

  add(titles, title, file);
  add(descriptions, description, file);
}

for (const [title, files] of titles.entries()) {
  if (files.length > 1 && title !== "الصفحة غير موجودة | كورة لايف") {
    problems.push(`Duplicate title "${title}" in: ${files.join(", ")}`);
  }
}

for (const [description, files] of descriptions.entries()) {
  if (files.length > 1) {
    problems.push(`Duplicate description in: ${files.join(", ")}`);
  }
}

const sitemap = read("sitemap.xml");
for (const url of [
  "https://koratv.click/",
  "https://koratv.click/news.html",
  "https://koratv.click/at-work/",
  "https://koratv.click/smart-tv/",
  "https://koratv.click/low-internet/",
  "https://koratv.click/abroad/",
]) {
  if (!sitemap.includes(`<loc>${url}</loc>`)) {
    problems.push(`sitemap.xml missing ${url}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(`SEO check passed for ${htmlFiles.length} HTML pages.`);
