import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMediaStreams, createMediaValidator } from '../media-validation.js';

const video = { codec_type: 'video', codec_name: 'h264', start_time: '100' };
const audio = { codec_type: 'audio', codec_name: 'aac', start_time: '100.1' };

test('source approval requires a browser-compatible video codec, not just an HTTP 200 segment', () => {
  assert.equal(assessMediaStreams([video, audio]).ok, true);
  assert.equal(assessMediaStreams([{ ...video, codec_name: 'hevc' }, audio]).error, 'unsupported_video_codec');
  assert.equal(assessMediaStreams([video, { ...audio, codec_name: 'ac3' }]).error, 'unsupported_audio_codec');
  assert.equal(assessMediaStreams([audio]).ok, false);
  assert.equal(assessMediaStreams([video]).ok, true);
});

test('source approval rejects unsynchronized timestamps and understands the MPEG timestamp wrap', () => {
  assert.equal(assessMediaStreams([{ ...video, start_time: '3420.3' }, { ...audio, start_time: '98092.5' }]).error, 'media_timestamps_misaligned');
  const wrap = 2 ** 33 / 90000;
  assert.equal(assessMediaStreams([{ ...video, start_time: String(wrap - .1) }, { ...audio, start_time: '0.1' }]).ok, true);
});

test('media validation is bounded, shares equivalent probes and explicitly rechecks changed sources', async () => {
  let calls = 0, now = 0, fail = false;
  const validate = createMediaValidator({ enabled: true, now: () => now, inspect: async () => {
    calls++; if (fail) throw new Error('private probe error'); return [video, audio];
  } });
  const results = await Promise.all([validate('source',new Uint8Array([71])),validate('source',new Uint8Array([71]))]);
  assert.ok(results.every(result => result.ok)); assert.equal(calls,1);
  await validate('source',new Uint8Array([71])); assert.equal(calls,1);
  await validate('source',new Uint8Array([71]),{fresh:true}); assert.equal(calls,2);
  now=61000; fail=true;
  assert.deepEqual(await validate('source',new Uint8Array([71])),{ok:false,error:'media_probe_failed'});
  assert.equal(JSON.stringify(await validate('source',new Uint8Array([71]))).includes('private'),false);
});
