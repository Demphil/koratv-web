import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function installBroadcastOverrides(inputPath, env = process.env) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  if (!input.matches || typeof input.matches !== 'object' || Array.isArray(input.matches)
    || Object.entries(input.matches).some(([id, row]) => !id || id.length > 160
      || typeof row.channel !== 'string' || !row.channel.trim() || row.channel.length > 100
      || /https?:|[/\\]/i.test(row.channel) || !Number.isFinite(Date.parse(row.expiresAt)))) {
    throw new Error('Invalid broadcaster corrections; previous settings retained');
  }
  const target = env.MANUAL_BROADCAST_OVERRIDE_PATH || '/etc/koratv/manual-broadcast-override.json';
  let previous = { matches: {} };
  try { previous = JSON.parse(await readFile(target, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const active = Object.fromEntries(Object.entries(input.matches).filter(([, row]) => Date.parse(row.expiresAt) > Date.now()));
  if (!Object.keys(active).length) return { applied: 0 };
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try { await copyFile(target, `${target}.${Date.now()}.backup`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...previous, matches: { ...previous.matches, ...active } }, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, target);
  return { applied: Object.keys(active).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await installBroadcastOverrides(process.argv[2])));
}
