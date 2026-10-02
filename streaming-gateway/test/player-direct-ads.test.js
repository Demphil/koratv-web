import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('player embeds direct Monetag ads and local cooldown logic in the page', () => {
  const html = readFileSync(new URL('../player/player.html', import.meta.url), 'utf8');
  assert.match(html, /https:\/\/nap5k\.com\/tag\.min\.js/);
  assert.match(html, /https:\/\/n6wxm\.com\/vignette\.min\.js/);
  assert.match(html, /https:\/\/omg10\.com\/4\/11908572/);
  assert.match(html, /AD_START_DELAY_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
  assert.match(html, /AD_COOLDOWN_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(html, /data-koratv-monetag/);
  assert.doesNotMatch(html, /ads-controller\.js|ads-config\.json|ad-frame\.html|profitablerate|al5sm|quge5/);
});

test('player CSP allows only the direct ad script hosts requested by the page', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /script-src 'self' 'unsafe-inline' https:\/\/nap5k\.com https:\/\/n6wxm\.com/);

  for (const file of ['nginx.conf.example', 'nginx.http-player.conf.example', 'nginx.oracle.conf.example']) {
    const nginx = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(nginx, /script-src 'self' 'unsafe-inline' https:\/\/nap5k\.com https:\/\/n6wxm\.com/);
    assert.match(nginx, /frame-src 'self' https:/);
    assert.doesNotMatch(nginx, /location = \/ad-frame\.html|sandbox allow-scripts|profitablerate|al5sm|quge5/);
  }
});

test('player redeploy applies nginx headers with the published files', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/sync-data.yml', import.meta.url), 'utf8');
  assert.match(workflow, /streaming-gateway\/nginx\.conf\.example/);
  assert.match(workflow, /streaming-gateway\/nginx\.http-player\.conf\.example/);
  assert.match(workflow, /install -m 0644 "\$ROOT\/nginx\.conf\.example" \/etc\/nginx\/sites-available\/koratv/);
  assert.match(workflow, /nginx -t/);
  assert.match(workflow, /systemctl reload nginx/);
});
