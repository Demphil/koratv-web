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
    const regressed = Number.isSafeInteger(sequence) && Number.isSafeInteger(previous?.sequence)
      && sequence < previous.sequence;
    // Concurrent readers can finish an older, overlapping playlist after a newer one.
    const reset = regressed && sequence + Math.max(1, segments.length) <= previous.sequence;
    if (regressed && !reset) return { stalled: false, stagnantForMs: 0, thresholdMs,
      reset: false, epoch: previous.epoch || 0, sequence, stale: true };
    const epoch = (previous?.epoch || 0) + Number(reset);
    const since = previous?.signature === signature ? previous.since : now;
    this.channels.set(key, { signature, since, lastSeen: now, epoch, sequence: Number.isSafeInteger(sequence) ? sequence : null });
    return { stalled: now - since >= thresholdMs, stagnantForMs: now - since, thresholdMs, reset, epoch, sequence: Number.isSafeInteger(sequence) ? sequence : null };
  }

  clear(provider, channel) { this.channels.delete(`${provider}:${channel}`); }
}
