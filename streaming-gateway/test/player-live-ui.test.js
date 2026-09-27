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
