const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireTools = createRequire(path.join(root, 'tools/showcase/package.json'));
requireTools('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'frontend/app-showcase.mjs')],
  outfile: path.join(root, 'assets/js/app-showcase.js'),
  bundle: true, minify: true, format: 'esm', target: ['chrome100', 'firefox100', 'safari16'],
  nodePaths: [path.join(root, 'tools/showcase/node_modules')], legalComments: 'eof'
});
fs.mkdirSync(path.join(root, 'assets/vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'tools/showcase/node_modules/three/LICENSE'), path.join(root, 'assets/vendor/three-LICENSE.txt'));
fs.mkdirSync(path.join(root, 'assets/icons'), { recursive: true });
for (const icon of ['chevron-right', 'chevron-left', 'pause', 'play', 'expand', 'x'])
  fs.copyFileSync(path.join(root, 'tools/showcase/node_modules/lucide-static/icons', icon + '.svg'), path.join(root, 'assets/icons', icon + '.svg'));
fs.copyFileSync(path.join(root, 'tools/showcase/node_modules/lucide-static/LICENSE'), path.join(root, 'assets/vendor/lucide-LICENSE.txt'));
console.log('Built local Three.js showcase; no CDN or runtime package installation required.');
