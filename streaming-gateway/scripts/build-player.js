import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { minify } from 'terser';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const require = createRequire(import.meta.url);
const api = new URL(process.env.PLAYER_API_ORIGIN || process.env.PUBLIC_API_ORIGIN || 'https://stream-api.koratv.click');
if (api.protocol !== 'https:') throw new Error('HTTPS required');
const resourceApi = new URL(process.env.PUBLIC_API_ORIGIN || api.origin);
if (resourceApi.protocol !== 'https:') throw new Error('HTTPS required');
const apiOrigins = [...new Set([api.origin, resourceApi.origin])];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('player', 'dist', { recursive: true,
  filter: (path) => !/\.(?:md|map)$/i.test(path) });
await cp('player/player.html', 'dist/739184.html');
await cp('player/player.html', 'dist/watch.html');
await cp(require.resolve('hls.js/dist/hls.min.js'), 'dist/hls.min.js');
for (const asset of ['three.module.min.js', 'three.core.min.js']) {
  await cp(join(dirname(require.resolve('three')), asset), `dist/${asset}`);
}
for (const asset of ['plyr.js', 'plyr.css', 'plyr.svg']) {
  await cp(join(dirname(require.resolve('plyr')), asset), `dist/${asset}`);
}
await mkdir('dist/icons', { recursive: true });
for (const icon of ['mail', 'trophy', 'scale', 'landmark', 'tv']) {
  await cp(join(dirname(require.resolve('lucide-static/package.json')), 'icons', `${icon}.svg`), `dist/icons/${icon}.svg`);
}
await writeFile('dist/config.js', `const STREAM_API_ORIGIN = ${JSON.stringify(api.origin)};\nconst STREAM_API_ORIGINS = new Set(${JSON.stringify(apiOrigins)});\n`);
for (const asset of ['config.js', 'player.js', 'broadcast-control.js', 'page-depth.js', 'embed-mode.js', 'player-branding.js', 'multiview.js',
  'hls.min.js', 'plyr.js', 'three.module.min.js', 'three.core.min.js']) {
  const result = await minify(await readFile(`dist/${asset}`, 'utf8'), {
    compress: false, mangle: { toplevel: false }, sourceMap: false, format: { comments: false },
    module: asset.startsWith('three.') || asset === 'page-depth.js'
  });
  if (!result.code || result.map) throw new Error('Invalid player JavaScript build');
  await writeFile(`dist/${asset}`, result.code + '\n');
}
const version = createHash('sha256');
for (const asset of ['config.js', 'player.js', 'broadcast-control.js', 'player.css', 'match-ui.css', 'page-depth.js', 'embed-mode.js', 'player-branding.js', 'hls.min.js', 'plyr.js', 'plyr.css']) {
  version.update(await readFile(`dist/${asset}`));
}
const revision = version.digest('hex').slice(0, 12);
const html = (await readFile('player/player.html', 'utf8')).replace(/((?:src|href)="\.\/[^"?]+\.(?:js|css))"/g, `$1?v=${revision}"`);
for (const page of ['player.html', '739184.html', 'watch.html']) await writeFile(`dist/${page}`, html);
