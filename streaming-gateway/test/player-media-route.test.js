import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function isAllowedStreamApiUrl('), source.indexOf('function hlsOptions('));
const setup = (extra = {}) => vm.createContext({ URL,
  STREAM_API_ORIGIN: 'https://stream-api.koratv.click', STREAM_MEDIA_ORIGIN: 'https://fabor.sbs',
  STREAM_API_ORIGINS: new Set(['https://stream-api.koratv.click', 'https://fabor.sbs']), ...extra });

test('video routing preserves sealed resources and leaves API control requests unchanged', () => {
  const context = setup();
  vm.runInContext(block, context);
  assert.equal(vm.runInContext('mediaRequestUrl("https://stream-api.koratv.click/api/resource?resource=sealed&v=1")', context),
    'https://fabor.sbs/api/resource?resource=sealed&v=1');
  assert.equal(vm.runInContext('mediaRequestUrl("/api/stream.m3u8?quality=720")', context),
    'https://fabor.sbs/api/stream.m3u8?quality=720');
  assert.equal(context.STREAM_API_ORIGIN, 'https://stream-api.koratv.click');
});

test('video loader never sends authorization to unapproved origins or API paths', () => {
  const context = setup();
  vm.runInContext(block, context);
  for (const value of ['https://evil.example/api/resource', 'http://fabor.sbs/api/resource',
    'https://fabor.sbs/api/operator/state', 'https://fabor.sbs/api/generate-token']) {
    assert.throws(() => vm.runInContext(`mediaRequestUrl(${JSON.stringify(value)})`, context), /Unexpected media/);
  }
  context.STREAM_MEDIA_ORIGIN = 'https://evil.example';
  assert.throws(() => vm.runInContext('mediaRequestUrl("/api/resource")', context), /Unexpected media relay/);
});

test('media routing defaults to the existing API for builds without a relay', () => {
  const context = setup();
  delete context.STREAM_MEDIA_ORIGIN;
  vm.runInContext(block, context);
  assert.equal(vm.runInContext('mediaRequestUrl("/api/resource?resource=sealed")', context),
    'https://stream-api.koratv.click/api/resource?resource=sealed');
});

test('relay loader inherits HLS cancellation and passes a copied request to the normal loader', () => {
  const calls = [];
  class Loader {
    load(...args) { calls.push(args); }
    abort() { calls.push('abort'); }
    destroy() { calls.push('destroy'); }
  }
  const context = setup({ Hls: { DefaultConfig: { loader: Loader } } });
  vm.runInContext(block, context);
  const RelayLoader = vm.runInContext('mediaLoader()', context);
  const loader = new RelayLoader();
  const request = { url: 'https://stream-api.koratv.click/api/resource?resource=sealed', rangeStart: 0, rangeEnd: 100 };
  const config = {}, callbacks = {};
  loader.load(request, config, callbacks);
  assert.equal(request.url, 'https://stream-api.koratv.click/api/resource?resource=sealed');
  assert.equal(calls[0][0].url, 'https://fabor.sbs/api/resource?resource=sealed');
  assert.equal(calls[0][0].rangeEnd, 100);
  assert.equal(calls[0][1], config);
  assert.equal(calls[0][2], callbacks);
  loader.abort(); loader.destroy();
  assert.deepEqual(calls.slice(1), ['abort', 'destroy']);
});
