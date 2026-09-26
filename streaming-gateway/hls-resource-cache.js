const cacheableHeaders = ['content-type', 'content-range', 'accept-ranges'];

function responseSnapshot(response, body) {
  const headers = {};
  for (const name of cacheableHeaders) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: Buffer.from(body),
    url: response.url
  };
}

function responseFromSnapshot(snapshot) {
  const response = new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers
  });
  if (snapshot.url) Object.defineProperty(response, 'url', { value: snapshot.url });
  return response;
}

export class HlsResourceCache {
  constructor({ maxBytes = 32 * 1024 * 1024, maxEntryBytes = 8 * 1024 * 1024, prefetchConcurrency = 2, maxPrefetchQueue = 24 } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntryBytes = maxEntryBytes;
    this.prefetchConcurrency = prefetchConcurrency;
    this.maxPrefetchQueue = maxPrefetchQueue;
    this.entries = new Map();
    this.inflight = new Map();
    this.prefetchQueue = [];
    this.prefetchKeys = new Set();
    this.bytes = 0;
    this.prefetchActive = 0;
    this.hits = 0;
    this.misses = 0;
    this.coalesced = 0;
    this.prefetched = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.snapshot;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.size;
    this.entries.delete(key);
  }

  async load(key, { ttlMs, cache = true }, loader) {
    if (cache) {
      const hit = this.get(key);
      if (hit) return responseFromSnapshot(hit);
    }
    let pending = this.inflight.get(key);
    if (pending) {
      this.coalesced += 1;
      return responseFromSnapshot(await pending);
    }

    this.misses += 1;
    pending = (async () => {
      const response = await loader();
      const snapshot = responseSnapshot(response, await response.arrayBuffer());
      if (cache && response.status === 200 && snapshot.body.byteLength <= this.maxEntryBytes && ttlMs > 0) {
        const existing = this.entries.get(key);
        if (existing) this.delete(key);
        this.entries.set(key, { snapshot, size: snapshot.body.byteLength, expiresAt: Date.now() + ttlMs });
        this.bytes += snapshot.body.byteLength;
        while (this.bytes > this.maxBytes && this.entries.size) this.delete(this.entries.keys().next().value);
      }
      return snapshot;
    })();
    this.inflight.set(key, pending);
    try {
      return responseFromSnapshot(await pending);
    } finally {
      if (this.inflight.get(key) === pending) this.inflight.delete(key);
    }
  }

  schedulePrefetch(key, options, loader) {
    if (this.get(key) || this.inflight.has(key) || this.prefetchKeys.has(key) || this.prefetchQueue.length + this.prefetchActive >= this.maxPrefetchQueue) return;
    this.prefetchKeys.add(key);
    this.prefetchQueue.push({ key, options, loader });
    this.pumpPrefetchQueue();
  }

  pumpPrefetchQueue() {
    while (this.prefetchActive < this.prefetchConcurrency && this.prefetchQueue.length) {
      const job = this.prefetchQueue.shift();
      this.prefetchActive += 1;
      this.load(job.key, job.options, job.loader)
        .then((response) => {
          if (response.ok) this.prefetched += 1;
          return response.body?.cancel();
        })
        .catch(() => {})
        .finally(() => {
          this.prefetchActive -= 1;
          this.prefetchKeys.delete(job.key);
          this.pumpPrefetchQueue();
        });
    }
  }

  stats() {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      inflight: this.inflight.size,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      prefetched: this.prefetched,
      prefetchQueued: this.prefetchQueue.length
    };
  }
}
