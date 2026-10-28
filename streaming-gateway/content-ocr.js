import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function command(name, args, input, maxBytes = 3 * 1024 * 1024, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    const chunks = [];
    let bytes = 0, settled = false;
    const finish = (error, output) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolve(output);
    };
    const timer = setTimeout(() => finish(new Error('content_inspection_timeout')), timeoutMs);
    child.on('error', () => finish(new Error('content_inspector_unavailable')));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) finish(new Error('content_sample_too_large'));
      else chunks.push(chunk);
    });
    child.on('close', code => finish(code === 0 ? null : new Error('content_inspection_failed'), Buffer.concat(chunks)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function parseOcrTsv(value) {
  return String(value).split(/\r?\n/).slice(1).flatMap(line => {
    const cells = line.split('\t');
    const confidence = Number(cells[10]);
    return cells[0] === '5' && confidence >= 50 && cells[11]?.trim()
      ? [{ text: cells.slice(11).join(' '), confidence }] : [];
  });
}

// Decode bytes already fetched under the gateway lease, never a second upstream URL.
export async function inspectContentFrames(segment, { language = 'eng+ara', python = process.env.STREAM_CONTENT_OCR_PYTHON || '/opt/koratv/content-ocr-venv/bin/python' } = {}) {
  const input = Buffer.from(segment);
  if (!input.length || input.length > 16 * 1024 * 1024) throw new Error('content_sample_too_large');
  const images = [];
  for (const offset of ['0.2', '1.2']) {
    const image = await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', 'pipe:0',
      '-ss', offset, '-vf', 'crop=iw:trunc(ih*0.32/2)*2:0:0,scale=1920:-1,format=gray',
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-threads', '1', 'pipe:1'], input);
    if (image.length) images.push(image);
  }
  try {
    const input = Buffer.from(JSON.stringify({ images: images.map(image => image.toString('base64')) }));
    const output = await command(python, [fileURLToPath(new URL('./scripts/content-ocr.py', import.meta.url))], input, 256 * 1024, 12_000);
    const samples = JSON.parse(output.toString('utf8'));
    if (!Array.isArray(samples) || samples.length !== images.length) throw new Error('invalid_content_inspection');
    return Object.assign(samples, { engine: 'rapidocr-local' });
  } catch {
    const samples = [];
    for (const image of images) {
      const output = await command('tesseract', ['stdin', 'stdout', '-l', language, '--psm', '11', 'tsv'], image, 256 * 1024);
      samples.push(parseOcrTsv(output.toString('utf8')));
    }
    return Object.assign(samples, { engine: 'tesseract-local' });
  }
}
