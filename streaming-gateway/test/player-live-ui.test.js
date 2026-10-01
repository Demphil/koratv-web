import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../player/player.js', import.meta.url), 'utf8');
const action = source.slice(source.indexOf('function returnToLive()'), source.indexOf('function updateQualityMenu('));

test('live controls omit seek, time and quality UI and disable keyboard seeking', () => {
  const controls = source.match(/controls: \[([^\]]+)\]/)[1];
  assert.doesNotMatch(controls, /progress|current-time|duration|settings/);
  assert.match(source, /keyboard: \{ focused: false, global: false \}/);
  assert.match(source, /liveButton\.addEventListener\('click', returnToLive\)/);
});

test('manifest and fragment progress cancel the initial playback timeout', () => {
  const parsedStart = source.indexOf('hls.on(Hls.Events.MANIFEST_PARSED');
  const parsedEnd = source.indexOf('hls.on(Hls.Events.LEVEL_SWITCHED', parsedStart);
  const parsedBlock = source.slice(parsedStart, parsedEnd);
  assert.match(parsedBlock, /clearTimeout\(loadTimer\)/);
  assert.doesNotMatch(parsedBlock, /readyState\s*>=\s*3\)\s*clearTimeout\(loadTimer\)/);
  assert.match(source, /hls\.on\(Hls\.Events\.FRAG_LOADED[\s\S]*clearTimeout\(loadTimer\)/);
});

test('hls resource guard allows same-origin resource proxy only', () => {
  const start = source.indexOf('function isAllowedStreamApiUrl');
  const end = source.indexOf('function hlsOptions', start);
  const guardSource = source.slice(start, end);
  const sandbox = {
    URL,
    location: { origin: 'https://fabor.sbs' },
    STREAM_API_ORIGINS: new Set(['https://stream-api.koratv.click'])
  };
  vm.runInNewContext(`${guardSource};this.check=isAllowedStreamApiUrl;`, sandbox);
  assert.equal(sandbox.check('https://stream-api.koratv.click/api/stream.m3u8'), true);
  assert.equal(sandbox.check('https://fabor.sbs/api/resource?resource=opaque'), true);
  assert.equal(sandbox.check('https://fabor.sbs/api/stream.m3u8'), false);
  assert.equal(sandbox.check('https://example.com/api/resource?resource=opaque'), false);
});

test('live action seeks to liveSyncPosition, clamps stale edges, and tolerates an empty window', () => {
  for (const [sync, expected] of [[150, 150], [50, 100], [300, 199.9], [undefined, 199], [NaN, 199]]) {
    let played = 0;
    const video = { currentTime: 120, seekable: { length: 1, start: () => 100, end: () => 200 }, play: () => { played++; return Promise.resolve(); } };
    vm.runInNewContext(action + ';returnToLive()', { video, hls: { liveSyncPosition: sync } });
    assert.equal(video.currentTime, expected);
    assert.equal(played, 1);
  }
  const video = { currentTime: 42, seekable: { length: 0 } };
  vm.runInNewContext(action + ';returnToLive()', { video, hls: undefined });
  assert.equal(video.currentTime, 42);
});
