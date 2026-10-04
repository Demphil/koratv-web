import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
export async function hashOperatorPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt, 32, options)).toString('hex')}`;
}
export async function verifyOperatorPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [type, salt, hex] = String(stored || '').split(':');
  if (type !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(hex || '')) return false;
  return timingSafeEqual(await derive(password, salt, 32, options), Buffer.from(hex, 'hex'));
}
export const sessionDigest = token => createHash('sha256').update(token).digest('hex');
export const operatorCookie = '__Host-koratv-operator';
export function readOperatorCookie(req) {
  return String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${operatorCookie}=`))?.slice(operatorCookie.length + 1) || '';
}
