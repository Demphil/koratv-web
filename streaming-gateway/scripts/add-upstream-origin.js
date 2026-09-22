import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(process.argv[2]);
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Provide an HTTP(S) origin without credentials or a path');
}
const file = new URL('../.env', import.meta.url);
const text = await readFile(file, 'utf8');
const pattern = /^UPSTREAM_ORIGINS=(.*)$/m;
const origins = new Set((text.match(pattern)?.[1] || '').trim().split(',').filter(Boolean));
origins.add(origin.origin);
const line = `UPSTREAM_ORIGINS=${[...origins].join(',')}`;
await writeFile(file, pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`, { mode: 0o600 });
console.log('Approved upstream origin saved. Restart the gateway to apply.');
