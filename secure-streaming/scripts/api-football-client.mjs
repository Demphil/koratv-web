import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function createApiFootballClient({ key, baseUrl, timeoutMs = 15000, retries = 2, minIntervalMs = 250,
  cacheDir = '', dailyBudget = 0, quotaReserve = 0, now = () => Date.now(),
  fetchImpl = (...args) => fetch(...args), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  for (const [name, value] of Object.entries({ dailyBudget, quotaReserve, minIntervalMs })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid API-Football ${name}`);
  }
  let pending = Promise.resolve();
  const inflight = new Map(), memory = new Map();
  const metrics = { requests: 0, cacheHits: 0, deduplicated: 0 };
  const namespace = createHash('sha256').update(`${baseUrl}:${key}`).digest('hex').slice(0, 24);
  const directory = cacheDir ? join(cacheDir, namespace) : '';
  let state = { day: '', used: 0, remainingDaily: null, nextRequestAt: 0 };
  const readJson = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  } };
  const save = async (name, value) => {
    if (!directory) return;
    const path = join(directory, name), temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  };
  // Share pacing, daily budget and cache misses across worker processes.
  const lock = async () => {
    if (!directory) return async () => {};
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'request.lock'), started = Date.now();
    for (;;) {
      try { const file = await open(path, 'wx', 0o600); await file.close();
        return async () => { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try { if (Date.now() - (await stat(path)).mtimeMs > 120000) await unlink(path); }
        catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
        if (Date.now() - started > 65000) throw new Error('API-Football shared request lock timeout');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  };
  const resetDay = () => {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (state.day !== day) state = { day, used: 0, remainingDaily: null, nextRequestAt: 0 };
  };
  const cached = async (id, ttlMs) => {
    if (!(ttlMs > 0)) return null;
    let entry = memory.get(id);
    if (!entry || now() - entry.savedAt >= ttlMs) entry = directory ? await readJson(join(directory, `${id}.json`)) : null;
    if (!entry || !Array.isArray(entry.response) || now() < entry.savedAt || now() - entry.savedAt >= ttlMs) return null;
    memory.set(id, entry);
    if (memory.size > 256) memory.delete(memory.keys().next().value);
    metrics.cacheHits++;
    return structuredClone(entry.response);
  };
  const perform = async (url, id, ttlMs) => {
    const hit = await cached(id, ttlMs);
    if (hit) return hit;
    const release = await lock();
    try {
      const sharedHit = await cached(id, ttlMs);
      if (sharedHit) return sharedHit;
      if (directory) state = await readJson(join(directory, 'quota.json')) || state;
      resetDay();
      if (directory && state.cleanedDay !== state.day) {
        for (const name of await readdir(directory)) {
          if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
          const path = join(directory, name);
          if (now() - (await stat(path)).mtimeMs > 7 * 86400000) await unlink(path);
        }
        state.cleanedDay = state.day;
        await save('quota.json', state);
      }
      const headers = { 'x-apisports-key': key, accept: 'application/json' };
      if (/rapidapi/i.test(url.hostname)) Object.assign(headers, { 'x-rapidapi-key': key, 'x-rapidapi-host': url.hostname });
      for (let attempt = 0; ; attempt++) {
        resetDay();
        if (state.remainingDaily != null && state.remainingDaily <= quotaReserve) throw new Error('API-Football daily quota exhausted or reserved');
        if (dailyBudget > 0 && state.used >= dailyBudget) throw new Error('API-Football local daily budget exhausted');
        await sleep(Math.max(0, state.nextRequestAt - now()));
        state.nextRequestAt = now() + minIntervalMs;
        state.used++;
        metrics.requests++;
        await save('quota.json', state);
        let response, body;
        try {
          response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
          const quota = response.headers.get('x-ratelimit-requests-remaining');
          if (quota != null && /^\d+$/.test(quota)) state.remainingDaily = Number(quota);
          if (response.headers.get('x-ratelimit-remaining') === '0') state.nextRequestAt = Math.max(state.nextRequestAt, now() + 60000);
          await save('quota.json', state);
          body = await response.json();
        } catch {
          if (attempt >= retries) throw new Error(`API-Football ${url.pathname} transport or JSON failure`);
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const errors = body?.errors && typeof body.errors === 'object' ? Object.keys(body.errors) : [];
        if (response.ok && !errors.length && Array.isArray(body?.response)) {
          if (ttlMs > 0) {
            const entry = { savedAt: now(), response: body.response };
            memory.set(id, entry);
            if (memory.size > 256) memory.delete(memory.keys().next().value);
            await save(`${id}.json`, entry);
          }
          return structuredClone(body.response);
        }
        const retryable = response.status === 429 || errors.some(name => /ratelimit/i.test(name)) || response.status >= 500;
        if (state.remainingDaily === 0 || !retryable || attempt >= retries) throw new Error(`API-Football ${url.pathname} failed (${response.status}; ${errors.join(',') || 'invalid_response'})`);
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Math.min(10000, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
      }
    } finally { await release(); }
  };
  return {
    request(path, parameters = {}, { ttlMs = 0 } = {}) {
      const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
      for (const [name, value] of Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))) {
        if (value == null || value === '') continue;
        if (/[\u0600-\u06ff]/.test(String(value))) return Promise.reject(new Error('API-Football queries require English names or numeric IDs'));
        const normalized = name === 'ids' ? [...new Set(String(value).split('-'))].sort((a, b) => Number(a) - Number(b)).join('-') : String(value);
        url.searchParams.set(name, normalized);
      }
      const id = createHash('sha256').update(url.href).digest('hex');
      if (inflight.has(id)) { metrics.deduplicated++; return inflight.get(id).then(structuredClone); }
      const result = pending.then(() => perform(url, id, ttlMs));
      pending = result.catch(() => {});
      inflight.set(id, result);
      void result.finally(() => inflight.delete(id)).catch(() => {});
      return result;
    },
    quota: () => { resetDay(); return { ...state, ...metrics }; },
  };
}
