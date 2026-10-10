const { readFile, writeFile, readdir } = require('node:fs/promises');
const { resolve, join } = require('node:path');

async function main() {
  const root = resolve(process.argv[2] || '.');
  const response = await fetch('https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.4.0/metadata/icons.json');
  if (!response.ok) throw new Error(`Font Awesome metadata: ${response.status}`);
  const icons = await response.json();
  const names = new Set();
  const files = ['index.html', ...(await readdir(join(root, 'assets/js'))).filter(name => name.endsWith('.js')).map(name => `assets/js/${name}`)];
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8');
    for (const match of text.matchAll(/\bfa-([a-z][a-z0-9-]*)/g)) names.add(match[1]);
  }
  const utilities = new Set(['spin', 'pulse', 'fw', 'lg', '2x', '3x', 'solid', 'regular', 'brands']);
  let css = '/* Font Awesome Free 6.4.0 icons, CC BY 4.0: https://fontawesome.com/license/free */\n';
  css += '.fas,.far,.fab{display:inline-block;width:1.25em;height:1em;vertical-align:-.125em;flex-shrink:0}\n';
  css += '.fas::before,.far::before,.fab::before{content:"";display:block;width:100%;height:100%;background:currentColor;-webkit-mask:var(--icon) center/contain no-repeat;mask:var(--icon) center/contain no-repeat}\n';
  for (const name of [...names].sort()) {
    if (utilities.has(name)) continue;
    const icon = icons[name] || Object.values(icons).find(icon => icon.aliases?.names?.includes(name));
    if (!icon) throw new Error(`Unknown icon: ${name}`);
    const style = icon.svg.solid ? 'solid' : icon.svg.brands ? 'brands' : 'regular';
    css += `.fa-${name}{--icon:url("data:image/svg+xml,${encodeURIComponent(icon.svg[style].raw)}")}\n`;
    if (icon.svg.regular && style !== 'regular') css += `.far.fa-${name}{--icon:url("data:image/svg+xml,${encodeURIComponent(icon.svg.regular.raw)}")}\n`;
  }
  css += '@keyframes fa-spin{to{transform:rotate(360deg)}}.fa-spin{animation:fa-spin 2s linear infinite}@media(prefers-reduced-motion:reduce){.fa-spin{animation:none}}\n';
  await writeFile(join(root, 'assets/css/icons.css'), css);
  console.log(`Generated ${names.size} icon selectors, ${Buffer.byteLength(css)} bytes for ${root}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
