const { cp, mkdir, readdir, readFile, rm, writeFile } = require('node:fs/promises');
const { resolve, relative, join, extname } = require('node:path');
const { minify } = require('terser');
const { load } = require('cheerio');

const directories = new Set(['assets', 'abroad', 'at-work', 'low-internet', 'smart-tv']);
const extensions = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg', '.woff', '.woff2']);
const rootFiles = new Set(['CNAME', 'robots.txt', 'sitemap.xml', 'sw.js']);
const verificationFile = /^(?:[a-f0-9]{32}|hta-code-\d+|ppck-ver-[a-f0-9]+)\.txt$/i;
const prohibitedAds = /\b(?:adsterra|highrevenueformat|profitableratecpmnetwork|highperformanceformat|profitabledisplaynetwork|topcreativeformat|effectivegatecpm|effectivecreativeformat|profitablecpmrate)\.com\b|\batOptions\s*=/i;
// Retired aliases previously displayed this same daily results table.
const legacyMatchPages = ['kora-online.html', 'koora-extra.html', 'kooracity.html', 'yalla-live.html', 'yalla-shoot-hd.html'];

function legacyMatchRedirect(siteUrl) {
  const target = new URL('/', siteUrl).href;
  if (!/^https?:$/.test(new URL(target).protocol)) throw new Error('Invalid website origin');
  const escaped = target.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"><link rel="canonical" href="${escaped}"><title>KoraTV</title></head><body><a href="${escaped}">جدول المباريات والنتائج</a></body></html>`;
}

function assertNoSecret(text, path) {
  if (/\/api\/operator\//.test(text)) throw new Error('Private console route in public asset: ' + path);
  if (/sb_secret_|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error('Private credential in public asset: ' + path);
  }
  for (const token of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
    let payload;
    try { payload = JSON.parse(Buffer.from(token[1], 'base64url')); } catch { continue; }
    if (payload.role === 'service_role') throw new Error('Service credential in public asset: ' + path);
  }
}

async function copyPublicDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyPublicDirectory(from, to);
    else if (entry.isFile() && (extensions.has(extname(entry.name).toLowerCase()) || entry.name === 'OFL.txt')) await cp(from, to);
  }
}

async function minifyScripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await minifyScripts(path);
    else if (/\.(?:html|m?js|css|svg)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      assertNoSecret(source, path);
      if (prohibitedAds.test(source)) throw new Error('Prohibited Adsterra advertising in public asset: ' + path);
      if (!/\.(?:m?js)$/.test(entry.name)) continue;
      const result = await minify(source, { compress: false, mangle: { toplevel: false },
        module: entry.name.endsWith('.mjs'), sourceMap: false, format: { comments: false } });
      if (!result.code || result.map) throw new Error('Invalid public JavaScript build');
      await writeFile(path, result.code + '\n');
    }
  }
}

async function buildPublicSite({ root = process.cwd(), output = join(root, '_site') } = {}) {
  root = resolve(root);
  output = resolve(output);
  if (relative(root, output) !== '_site') throw new Error('Output must be the workspace _site directory');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && directories.has(entry.name)) {
      await copyPublicDirectory(join(root, entry.name), join(output, entry.name));
    } else if (entry.isFile() && (rootFiles.has(entry.name) || entry.name.endsWith('.html') || verificationFile.test(entry.name))) {
      await cp(join(root, entry.name), join(output, entry.name));
    }
  }
  // Only this shared module is imported by the public frontend.
  await mkdir(join(output, 'shared'), { recursive: true });
  await cp(join(root, 'shared/match-lifecycle.mjs'), join(output, 'shared/match-lifecycle.mjs'));
  await minifyScripts(output);
  // Keep first-paint styles in the document, without extra network round trips.
  const homepage = join(output, 'index.html');
  const $ = load(await readFile(homepage, 'utf8'));
  for (const link of $('link[rel="stylesheet"]').toArray()) {
    const path = ($(link).attr('href') || '').split('?')[0];
    if (!['/assets/css/matches.css', '/assets/css/footer.css', '/assets/css/fonts.css'].includes(path)) continue;
    const css = await readFile(join(output, path.slice(1)), 'utf8');
    $(link).replaceWith($('<style>').attr('data-source', path).text(css));
  }
  await writeFile(homepage, $.html());
  const configuredHost = (await readFile(join(root, 'CNAME'), 'utf8')).trim();
  const siteUrl = new URL(configuredHost.includes('://') ? configuredHost : `https://${configuredHost}`).origin;
  for (const page of legacyMatchPages) await writeFile(join(output, page), legacyMatchRedirect(siteUrl));
  return output;
}

module.exports = { buildPublicSite, legacyMatchPages, legacyMatchRedirect };
if (require.main === module) buildPublicSite().then(path => console.log('Public website built: ' + path))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
