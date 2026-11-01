const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { readBuildState } = require('./build-state.cjs');
test('local publication state reads only bounded archive files and fails closed on missing or foreign state', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'site-build-state-'));
  try {
    await fs.mkdir(path.join(dir, 'archive'));
    await fs.writeFile(path.join(dir, 'archive/catalog.json'), '{"version":2}');
    assert.equal(await readBuildState(dir, 'https://koratv.click/archive/catalog.json?build=1', 'https://koratv.click'), '{"version":2}');
    await assert.rejects(readBuildState(dir, 'https://other.test/archive/catalog.json', 'https://koratv.click'), /origin/);
    await assert.rejects(readBuildState(dir, 'https://koratv.click/.env', 'https://koratv.click'), /path/);
    await assert.rejects(readBuildState(dir, 'https://koratv.click/archive/%2e%2e/.env', 'https://koratv.click'), /path/);
    await assert.rejects(readBuildState(dir, 'https://koratv.click/news/catalog.json', 'https://koratv.click'), /ENOENT/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
