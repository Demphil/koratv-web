import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const gateway = new URL('../.env', import.meta.url);
const frontend = new URL('../../secure-streaming/.env', import.meta.url);
const validHttpsOrigin = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
const publicValues = {
  NEXT_PUBLIC_SUPABASE_URL: { value: 'https://vzgldruuinbwslrfwjkb.supabase.co', valid: validHttpsOrigin },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    value: 'sb_publishable_UWDsCT0XpmEVvoy7CaMFNg_kN64Phlo',
    valid: (value) => value === 'sb_publishable_UWDsCT0XpmEVvoy7CaMFNg_kN64Phlo'
  }
};
async function configure(path, defaults, replacements) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    text = defaults;
  }
  for (const [name, replacement] of Object.entries(replacements)) {
    const value = typeof replacement === 'string' ? replacement : replacement.value;
    const valid = typeof replacement === 'string' ? (candidate) => Boolean(candidate) : replacement.valid;
    const pattern = new RegExp(`^${name}=(.*)$`, 'm');
    const existing = text.match(pattern)?.[1]?.trim();
    if (existing && !existing.startsWith('replace-') && valid(existing)) continue;
    text = pattern.test(text) ? text.replace(pattern, `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(path, text, { mode: 0o600 });
  return text;
}
const validSecret = (value) => value.length >= 32 && !value.startsWith('replace-');
const randomSecret = () => randomBytes(48).toString('hex');
const gatewayText = await configure(gateway, await readFile(new URL('../.env.example', import.meta.url), 'utf8'), {
  ...publicValues,
  ENABLE_ANTI_BOT: { value: 'true', valid: (value) => /^(true|false)$/i.test(value) },
  JWT_SECRET: { value: randomSecret(), valid: validSecret },
  HMAC_SECRET: { value: randomSecret(), valid: validSecret },
  PUBLIC_API_ORIGIN: {
    value: 'https://stream-api.koratv.click',
    valid: validHttpsOrigin
  },
  FRONTEND_ORIGIN: { value: 'https://koratv.click', valid: validHttpsOrigin },
  PLAYER_ORIGIN: { value: 'https://medic.cymru', valid: validHttpsOrigin }
});
const jwtSecret = gatewayText.match(/^JWT_SECRET=(.*)$/m)?.[1]?.trim();
await configure(gateway, gatewayText, {
  HMAC_SECRET: {
    value: randomSecret(),
    valid: (value) => validSecret(value) && value !== jwtSecret
  }
});
await configure(frontend, '', {
  ...publicValues,
  NEXT_PUBLIC_STREAM_GATEWAY_ORIGIN: { value: 'https://stream-api.koratv.click', valid: validHttpsOrigin }
});
console.log('Gateway and frontend .env files are ready. Existing values preserved; no secrets printed.');
