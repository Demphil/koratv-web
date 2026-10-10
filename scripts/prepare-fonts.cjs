const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

// Vendored Google Fonts assets retain Cairo's OFL license. Run only when updating fonts.
async function main() {
  const root = resolve(process.argv[2] || '.');
  const directory = join(root, 'assets/fonts');
  await mkdir(directory, { recursive: true });
  const response = await fetch('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }
  });
  if (!response.ok) throw new Error(`Font CSS: ${response.status}`);
  let css = await response.text();
  if (!css.includes("format('woff2')")) throw new Error('Expected WOFF2 font response');
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(match => match[1]))];
  for (const [index, url] of urls.entries()) {
    const font = await fetch(url);
    if (!font.ok) throw new Error(`Font: ${font.status}`);
    const filename = `cairo-${index}.woff2`;
    await writeFile(join(directory, filename), Buffer.from(await font.arrayBuffer()));
    css = css.split(url).join(`/assets/fonts/${filename}`);
  }
  await writeFile(join(root, 'assets/css/fonts.css'), css);
  const license = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/OFL.txt');
  if (!license.ok) throw new Error(`Font license: ${license.status}`);
  await writeFile(join(directory, 'OFL.txt'), await license.text());
  console.log(`Saved ${urls.length} Cairo font subsets in ${root}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
