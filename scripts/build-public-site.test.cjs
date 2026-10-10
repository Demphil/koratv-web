const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, access, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');
const { buildPublicSite, legacyMatchPages, legacyMatchRedirect } = require('./build-public-site.cjs');

test('publication allowlist excludes backend files, maps, credentials, and docs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'public-site-'));
  try {
    for (const directory of ['assets/js', 'shared', 'secure-streaming', 'streaming-gateway', 'functions', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const files = {
      'index.html': '<html>public</html>', 'CNAME': 'example.com',
      'sw.js': 'self.addEventListener("fetch", function(event) { void event; });',
      'assets/js/main.js': '// private author comment\nfunction increment(value) { return value + 1; }\n//# sourceMappingURL=main.js.map',
      'shared/match-lifecycle.mjs': 'export function state(value) { return value; }',
      'assets/js/main.js.map': '{"sourcesContent":["original"]}', 'assets/js/proxy.php': '<?php secret();',
      'shared/private.mjs': 'secret()', '.env': 'SECRET=x', 'package.json': '{}',
      'secure-streaming/server.js': 'secret()', 'streaming-gateway/app.js': 'secret()',
      'functions/worker.js': 'secret()', 'docs/config.md': 'internal', 'manual-match-selection.json': '{}'
    };
    for (const [path, value] of Object.entries(files)) await writeFile(join(root, path), value);
    const output = await buildPublicSite({ root });
    for (const path of ['index.html', 'CNAME', 'sw.js', 'assets/js/main.js', 'shared/match-lifecycle.mjs']) await access(join(output, path));
    for (const path of Object.keys(files).filter(path => !['index.html', 'CNAME', 'sw.js', 'assets/js/main.js', 'shared/match-lifecycle.mjs'].includes(path))) {
      await assert.rejects(access(join(output, path)), { code: 'ENOENT' });
    }
    const code = await readFile(join(output, 'assets/js/main.js'), 'utf8');
    assert.doesNotMatch(code, /sourceMappingURL|private author comment/);
    const context = vm.createContext({});
    vm.runInContext(code, context);
    assert.equal(context.increment(2), 3);
    await assert.rejects(buildPublicSite({ root, output: root }), /Output must/);
    await writeFile(join(root, 'index.html'), '<script>const key = "sb_secret_test_not_a_real_key";</script>');
    await assert.rejects(buildPublicSite({ root }), error => /Private credential/.test(error.message)
      && !error.message.includes('sb_secret_test'));
    await writeFile(join(root, 'index.html'), '<script src="/api/operator/ui/private.js"></script>');
    await assert.rejects(buildPublicSite({ root }), /Private console route/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('publication rejects Adsterra tags in HTML and nested scripts but preserves Monetag', async () => {
  const root = await mkdtemp(join(tmpdir(), 'public-ads-policy-'));
  try {
    await writeFile(join(root, 'CNAME'), 'koratv.click');
    await mkdir(join(root, 'shared'));
    await mkdir(join(root, 'assets/js'), { recursive: true });
    await writeFile(join(root, 'shared/match-lifecycle.mjs'), 'export const live = true;');
    const index = join(root, 'index.html');
    for (const tag of ['<script src="https://pl31377260.profitableratecpmnetwork.com/tag.js"></script>', '<script src="https://www.highrevenueformat.com/invoke.js"></script>', '<script>atOptions = { key: "test" };</script>']) {
      await writeFile(index, tag);
      await assert.rejects(buildPublicSite({ root }), /Prohibited Adsterra advertising/);
    }
    await writeFile(index, '<script src="https://al5sm.com/tag.min.js" data-zone="123"></script>');
    await writeFile(join(root, 'assets/js/ads.js'), 'const source = "https://www.highrevenueformat.com/invoke.js";');
    await assert.rejects(buildPublicSite({ root }), /Prohibited Adsterra advertising/);
    await writeFile(join(root, 'assets/js/ads.js'), 'const source = "https://omg10.com/4/123";');
    const output = await buildPublicSite({ root });
    assert.match(await readFile(join(output, 'index.html'), 'utf8'), /al5sm\.com/);
    assert.match(await readFile(join(output, 'assets/js/ads.js'), 'utf8'), /omg10\.com/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('known retired daily-table aliases lead to their equivalent current page', () => {
  assert.equal(legacyMatchPages.length, 5);
  const html = legacyMatchRedirect('https://koratv.click');
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /rel="canonical" href="https:\/\/koratv.click\/"/);
  assert.doesNotMatch(html, /<script/);
});
