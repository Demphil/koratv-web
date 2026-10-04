import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBroadcastOverrides } from '../scripts/install-broadcast-overrides.mjs';

test('broadcaster corrections preserve existing settings and reject invalid updates before writing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'broadcast-correction-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const target = join(dir, 'server.json'), input = join(dir, 'input.json');
  const old = {matches:{existing:{channel:'Exact TV',expiresAt:new Date(Date.now()+60_000).toISOString()}}};
  await writeFile(target,JSON.stringify(old));
  const correction = {channel:'On Sport Plus',expiresAt:new Date(Date.now()+60_000).toISOString()};
  await writeFile(input,JSON.stringify({matches:{egypt:correction}}));
  const env = {MANUAL_BROADCAST_OVERRIDE_PATH:target};
  assert.equal((await installBroadcastOverrides(input,env)).applied,1);
  const result = JSON.parse(await readFile(target,'utf8'));
  assert.deepEqual(result.matches.existing,old.matches.existing);
  assert.deepEqual(result.matches.egypt,correction);
  await writeFile(input,JSON.stringify({matches:{bad:{...correction,channel:'https://unsafe.test'}}}));
  await assert.rejects(()=>installBroadcastOverrides(input,env),/Invalid broadcaster/);
  assert.deepEqual(JSON.parse(await readFile(target,'utf8')),result);
});
