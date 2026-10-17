import { spawn } from 'node:child_process';

export function assessMediaStreams(streams = []) {
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  const details = { videoCodec: video?.codec_name || null, audioCodec: audio?.codec_name || null };
  if (!video || video.codec_name !== 'h264') return { ok: false, error: 'unsupported_video_codec', ...details };
  if (audio && !['aac', 'mp3'].includes(audio.codec_name)) return { ok: false, error: 'unsupported_audio_codec', ...details };
  if (audio && Number.isFinite(Number(video.start_time)) && Number.isFinite(Number(audio.start_time))) {
    const wrap = 2 ** 33 / 90000;
    const delta = Math.abs(Number(video.start_time) - Number(audio.start_time)) % wrap;
    if (Math.min(delta, wrap - delta) > 30) return { ok: false, error: 'media_timestamps_misaligned', ...details };
  }
  return { ok: true, ...details };
}

export function inspectMedia(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-analyzeduration', '2500000', '-probesize', '2097152',
      '-show_entries', 'stream=codec_type,codec_name,start_time', '-of', 'json', '-i', 'pipe:0'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) child.kill('SIGKILL'); });
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('media_probe_failed'));
      try { resolve(JSON.parse(output).streams || []); } catch { reject(new Error('media_probe_failed')); }
    });
    child.stdin.end(Buffer.from(bytes).subarray(0, 8 * 1024 * 1024));
  });
}

export function createMediaValidator({ enabled = false, inspect = inspectMedia, now = Date.now } = {}) {
  const cache = new Map(), inflight = new Map();
  return async (source, bytes, { fresh = false } = {}) => {
    if (!enabled) return { ok: true };
    const cached = cache.get(source);
    if (!fresh && cached?.until > now()) return cached.value;
    if (inflight.has(source)) return inflight.get(source);
    const task = (async () => {
      let value;
      try { value = assessMediaStreams(await inspect(bytes)); }
      catch { value = { ok: false, error: 'media_probe_failed' }; }
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(source, { value, until: now() + 60000 });
      return value;
    })().finally(() => inflight.delete(source));
    inflight.set(source, task);
    return task;
  };
}
