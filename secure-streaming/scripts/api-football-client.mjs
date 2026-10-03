export function createApiFootballClient({ key, baseUrl, timeoutMs = 15000, retries = 2, minIntervalMs = 250,
  fetchImpl = (...args) => fetch(...args), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let pending = Promise.resolve();
  let nextRequestAt = 0;
  let remainingDaily = null;
  const perform = async (path, parameters) => {
    if (remainingDaily === 0) throw new Error('API-Football daily quota exhausted');
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
    for (const [name, value] of Object.entries(parameters || {})) {
      if (value != null && value !== '') url.searchParams.set(name, String(value));
    }
    const headers = { 'x-apisports-key': key, accept: 'application/json' };
    if (/rapidapi/i.test(url.hostname)) {
      headers['x-rapidapi-key'] = key;
      headers['x-rapidapi-host'] = url.hostname;
    }
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, nextRequestAt - Date.now()));
      nextRequestAt = Date.now() + minIntervalMs;
      let response;
      let body;
      try {
        response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        const quota = response.headers.get('x-ratelimit-requests-remaining');
        if (quota != null && /^\d+$/.test(quota)) remainingDaily = Number(quota);
        body = await response.json();
      } catch {
        if (attempt >= retries) throw new Error(`API-Football ${path} transport or JSON failure`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const errors = body?.errors && typeof body.errors === 'object' ? Object.keys(body.errors) : [];
      if (response.ok && !errors.length && Array.isArray(body?.response)) return body.response;
      const rateLimited = response.status === 429 || errors.some(name => /ratelimit/i.test(name));
      const retryable = rateLimited || response.status >= 500;
      if (remainingDaily === 0 || !retryable || attempt >= retries) {
        throw new Error(`API-Football ${path} failed (${response.status}; ${errors.join(',') || 'invalid_response'})`);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Math.min(10000, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
    }
  };
  return {
    request(path, parameters = {}) {
      const result = pending.then(() => perform(path, parameters));
      pending = result.catch(() => {});
      return result;
    },
    quota: () => ({ remainingDaily }),
  };
}
