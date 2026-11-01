import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writePublicSnapshot } from './public-snapshot.mjs';
test('public snapshot remains readable after every private-umask atomic replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'public-match-feed-'));
  const oldMask = process.umask(0o077);
  const query = { select() { return this; }, eq() { return this; }, order() { return this; },
    async range() { return { data: [{ id: 'one', active: true, payload: { providerPassword: 'never-public' } }], error: null }; } };
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal(await writePublicSnapshot({ from: () => query }, { directory }), 1);
      if (process.platform !== 'win32') {
        assert.equal((await stat(directory)).mode & 0o777, 0o755);
        assert.equal((await stat(join(directory, 'matches.json'))).mode & 0o777, 0o644);
      }
      assert.doesNotMatch(await readFile(join(directory, 'matches.json'), 'utf8'), /never-public|providerPassword/);
    }
  } finally { process.umask(oldMask); await rm(directory, { recursive: true, force: true }); }
});
