import { readFile, mkdir, copyFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function installManualSelection(inputPath, env = process.env) {
  const selection = JSON.parse(await readFile(inputPath, 'utf8'));
  if (selection.source !== 'repository-manual-selection' || typeof selection.enabled !== 'boolean'
    || !/^\d{4}-\d{2}-\d{2}$/.test(selection.date || '')
    || !Array.isArray(selection.matches) || selection.matches.length > 8
    || selection.matches.some(id => typeof id !== 'string' || !id.trim() || id.length > 160)) {
    throw new Error('Invalid merged manual selection; existing selection retained');
  }
  const target = env.MANUAL_MATCH_SELECTION_PATH || `${env.PROVIDER_POOL_DIR || '/etc/koratv'}/manual-match-selection.json`;
  let previous;
  try { previous = JSON.parse(await readFile(target, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // An inactive repository file must not erase a pre-existing server-side choice.
  if (!selection.enabled && previous?.enabled && previous.source !== selection.source) {
    return { preservedLegacySelection: true };
  }
  if (previous) {
    const backupDir = env.MANUAL_SELECTION_BACKUP_DIR || '/opt/koratv/backups';
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backup = join(backupDir, `manual-selection-${Date.now()}-${randomUUID()}.json`);
    await copyFile(target, backup);
    await chmod(backup, 0o600);
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(selection, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, target);
  return { enabled: selection.enabled, selectedCount: selection.matches.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await installManualSelection(process.argv[2])));
}
