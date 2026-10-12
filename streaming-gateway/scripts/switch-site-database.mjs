import { readFile, writeFile, copyFile, chmod, rename, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const [targetFile, backupDirectory, ...files] = process.argv.slice(2);
if (!targetFile || !backupDirectory || !files.length) throw new Error('Target, private backup directory, and env files required');
const target = parseEnv(await readFile(targetFile, 'utf8'));
if (target.SUPABASE_URL !== 'https://amnguwuykrxvmwamlpjf.supabase.co'
  || !target.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')
  || !target.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw new Error('Invalid target configuration');
}
const replacements = {
  SUPABASE_URL: target.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: target.SUPABASE_URL,
  SUPABASE_SECRET_KEY: target.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: target.SUPABASE_SECRET_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: target.SUPABASE_PUBLISHABLE_KEY,
};
const planned = [];
for (const file of files) {
  const original = await readFile(file, 'utf8');
  const env = parseEnv(original);
  const oldUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (oldUrl !== 'https://vzgldruuinbwslrfwjkb.supabase.co') throw new Error(`Unexpected source configuration: ${file}`);
  const lines = original.split(/\r?\n/).filter(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
    return !match || !Object.hasOwn(replacements, match[1]);
  });
  const updated = `${lines.join('\n').trimEnd()}\n${Object.entries(replacements).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  planned.push({ file, updated });
}
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
for (const [index, { file }] of planned.entries()) {
  const backup = `${backupDirectory}/env-${index}.backup`;
  await copyFile(file, backup);
  await chmod(backup, 0o600);
}
await writeFile(`${backupDirectory}/paths.json`, JSON.stringify(files), { mode: 0o600, flag: 'wx' });
for (const { file, updated } of planned) {
  await writeFile(`${file}.migration-new`, updated, { mode: 0o600, flag: 'wx' });
  await rename(`${file}.migration-new`, file);
  await chmod(file, 0o600);
}
console.log(JSON.stringify({ target: new URL(target.SUPABASE_URL).hostname, updatedFiles: files, backupDirectory }));
