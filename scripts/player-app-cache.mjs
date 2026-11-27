import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createAppCacheClient({ origin, publicKey, cacheDir, now = Date.now, fetchImpl = fetch }) {
  if (origin !== 'https://api.korascoreai.com' || !publicKey) throw new Error('Invalid shared app cache configuration');
  const filename = join(cacheDir, 'app-viewer-cache.json');
  let memory, pending;
  const metrics = { cacheReads: 0, httpRequests: 0, providerRequests: 0 };
  async function load() {
    if (!memory) {
      try { memory = JSON.parse(await readFile(filename, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    if (memory && now() - memory.readAt >= 0 && now() - memory.readAt < 10 * 60000) { metrics.cacheReads++; return memory.rows; }
    metrics.httpRequests++;
    const response = await fetchImpl(origin + '/functions/v1/sports', { method: 'POST', redirect: 'error',
      headers: { apikey: publicKey, Authorization: `Bearer ${publicKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'liveFixtures', params: {} }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Shared app cache unavailable'); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error('Shared cache exceeds size limit'); }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(body) || body.length > 1000) throw new Error('Invalid shared app cache');
    const rows = body.filter(row => Number.isSafeInteger(row?.fixture?.id) && row.fixture.id > 0
      && (!row.source || row.source === 'api-football') && row.teams?.home?.id && row.teams?.away?.id);
    memory = { readAt: now(), rows };
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const temporary = filename + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(memory), { mode: 0o600 });
    await rename(temporary, filename);
    return rows;
  }
  return {
    mode: 'app-cache-only',
    async request(path, params) {
      if (path !== '/fixtures' || Object.keys(params).some(key => !['id', 'date', 'timezone'].includes(key))) throw new Error('Cache-only request denied');
      if (pending) await pending;
      else { pending = load(); try { await pending; } finally { pending = null; } }
      const rows = memory?.rows || [];
      if (params.id) return structuredClone(rows.filter(row => row.fixture.id === Number(params.id)));
      if (params.date) return structuredClone(rows.filter(row => new Date(row.fixture.date).toISOString().slice(0, 10) === params.date));
      throw new Error('A bounded fixture selector is required');
    },
    quota: () => ({ ...metrics }),
  };
}
