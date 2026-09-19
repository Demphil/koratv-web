import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const gateway = new URL('../.env', import.meta.url);
const frontend = new URL('../../secure-streaming/.env', import.meta.url);
const publicValues = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://vzgldruuinbwslrfwjkb.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_UWDsCT0XpmEVvoy7CaMFNg_kN64Phlo',
};
async function configure(path, defaults, replacements) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; text = defaults; }
  for (const [name, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`^${name}=(.*)$`, 'm');
    const existing = text.match(pattern)?.[1]?.trim();
    if (existing && !existing.startsWith('replace-')) continue;
    text = pattern.test(text) ? text.replace(pattern, `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(path, text, { mode: 0o600 });
}
await configure(gateway, await readFile(new URL('../.env.example', import.meta.url), 'utf8'), {
  ...publicValues, JWT_SECRET: randomBytes(48).toString('hex'), HMAC_SECRET: randomBytes(48).toString('hex'),
});
await configure(frontend, '', { ...publicValues, NEXT_PUBLIC_STREAM_GATEWAY_ORIGIN: 'https://stream-api.koratv.click' });
console.log('Gateway and frontend .env files are ready. Existing values preserved; no secrets printed.');
