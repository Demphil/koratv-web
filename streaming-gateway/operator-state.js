import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publicMatchId } from '../shared/public-match-id.mjs';
import { normalizeNoticeDesign } from './player/broadcast-notice.js';

export const operatorPath = (env = process.env) => env.OPERATOR_CONTROL_PATH || `${env.PROVIDER_POOL_DIR || '/etc/koratv'}/operator-control.json`;
export const emptyOperatorState = () => ({ revision: 0, selection: null, overrides: {}, channels: {}, notices: { enabled: false, campaign: '', items: [], repeats: 1, duration: 10, interval: 300, matchIds: [] } });
export async function readOperatorState(path) {
  try { return { ...emptyOperatorState(), ...JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return emptyOperatorState(); }
}
export async function writeOperatorState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, path);
}
export function activeOperatorOverride(state, matchId, now = Date.now()) {
  const row = state?.overrides?.[matchId];
  return row && row.enabled !== false && Date.parse(row.expiresAt) > now ? row.channel : null;
}
export function validateSelection(input, availableIds) {
  if (typeof input?.enabled !== 'boolean' || !Array.isArray(input.matches) || input.matches.length > 8
    || new Set(input.matches).size !== input.matches.length || input.matches.some(id => !availableIds.has(id))) throw new Error('invalid_selection');
  return { enabled: input.enabled, date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date()), matches: input.matches, source: 'operator-console' };
}
export function validateNotices(input) {
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (typeof input?.enabled !== 'boolean' || !Array.isArray(input.items) || input.items.length > 10
    || (input.enabled && !input.items.length) || !integer(input.repeats, 1, 1000)
    || !integer(input.duration, 5, 120) || !integer(input.interval, 0, 3600)
    || !Array.isArray(input.matchIds) || input.matchIds.length > 8
    || input.matchIds.some(id => typeof id !== 'string' || id.length > 160)) throw new Error('invalid_notices');
  const items = input.items.map(item => {
    const text = String(item.text || '').trim(), title = String(item.title || '').trim();
    if ((!text && !title && !item.image) || text.length > 240 || title.length > 100 || (item.image && !/^\/[a-z0-9/-]+$/i.test(item.image))
      || (item.duration !== undefined && item.duration !== null && !integer(item.duration, 5, 120))) throw new Error('invalid_notice');
    return { id: randomUUID(), title, text, image: item.image || '', duration: item.duration ?? null, design: normalizeNoticeDesign(item.design, true) };
  });
  return { enabled: input.enabled, campaign: randomUUID(), items, repeats: input.repeats, duration: input.duration, interval: input.interval, matchIds: input.matchIds };
}
export function publicControlState(state) {
  const notices = state.notices || emptyOperatorState().notices;
  return { revision: state.revision, channels: Object.fromEntries(Object.entries(state.channels || {}).map(([id, version]) => [publicMatchId(id), version])),
    notices: { ...notices, matchIds: notices.matchIds.map(publicMatchId) } };
}
