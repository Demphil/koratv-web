import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = new URL(process.env.PUBLIC_API_ORIGIN || 'https://stream-api.koratv.click');
if (api.protocol !== 'https:') throw new Error('HTTPS required');
await mkdir('dist', { recursive: true });
await cp('player', 'dist', { recursive: true });
await cp('player/player.html', 'dist/739184.html');
await cp(require.resolve('hls.js/dist/hls.min.js'), 'dist/hls.min.js');
await writeFile('dist/config.js', `const STREAM_API_ORIGIN = ${JSON.stringify(api.origin)};\n`);
await writeFile('dist/headers.txt', [
  'Set these HTTP response headers on the player host:',
  `Content-Security-Policy: default-src 'none'; script-src 'self' https: 'unsafe-inline'; style-src 'self'; img-src 'self' https: data:; media-src blob:; connect-src https:; worker-src blob:; frame-ancestors https: http:; base-uri 'none'; form-action 'none'`,
  'Referrer-Policy: no-referrer',
  'Cache-Control: no-store',
  'X-Content-Type-Options: nosniff',
  'Do not send X-Frame-Options on this host; public embeds are controlled by the in-player integrity guard.',
].join('\n'));
