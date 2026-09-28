import { createHash } from 'node:crypto';

export class HlsProgressMonitor {
  constructor({ now = Date.now, minimumStallMs = 12_000 } = {}) {
    this.now = now;
    this.minimumStallMs = minimumStallMs;
    this.channels = new Map();
  }

  observe(provider, channel, manifest) {
    const key = `${provider}:${channel}`;
    const sequence = Number(manifest.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m)?.[1]);
    const segments = manifest.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
    const tail = createHash('sha1').update(segments.slice(-3).join('\n')).digest('hex');
    const signature = Number.isSafeInteger(sequence) ? `sequence:${sequence}:${tail}` : `segments:${tail}`;
    const targetDuration = Number(manifest.match(/^#EXT-X-TARGETDURATION:(\d+)/m)?.[1]) || 6;
    const thresholdMs = Math.max(this.minimumStallMs, targetDuration * 2000);
    const now = this.now();
    const previous = this.channels.get(key);
    const since = previous?.signature === signature ? previous.since : now;
    this.channels.set(key, { signature, since, lastSeen: now, sequence: Number.isSafeInteger(sequence) ? sequence : null });
    return { stalled: now - since >= thresholdMs, stagnantForMs: now - since, thresholdMs, sequence: Number.isSafeInteger(sequence) ? sequence : null };
  }

  clear(provider, channel) { this.channels.delete(`${provider}:${channel}`); }
}
