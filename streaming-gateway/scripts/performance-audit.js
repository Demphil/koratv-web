import { Session } from 'node:inspector';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const release = process.argv[2] || process.cwd();
const { loadConfig } = await import(pathToFileURL(`${release}/config.js`));
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const started = performance.now();
  try {
    const response = await originalFetch(url, options);
    requests.push({ path: new URL(url).pathname, status: response.status, ms: Math.round(performance.now() - started) });
    return response;
  } catch (error) {
    requests.push({ path: new URL(url).pathname, error: error.name, ms: Math.round(performance.now() - started) });
    throw error;
  }
};
const inspector = new Session();
inspector.connect();
const post = (method) => new Promise((resolve, reject) => inspector.post(method, (error, result) => error ? reject(error) : resolve(result)));
await post('Profiler.enable');
await post('Profiler.start');
const config = loadConfig();
const started = performance.now();
const rows = await config.getMatchesForOrigin('https://koratv.click');
const listMs = Math.round(performance.now() - started);
const { profile } = await post('Profiler.stop');
inspector.disconnect();
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const samples = new Map();
for (const id of profile.samples || []) samples.set(id, (samples.get(id) || 0) + 1);
const hottest = [...samples].map(([id, ticks]) => ({ name: nodes.get(id)?.callFrame.functionName, ticks }))
  .filter((item) => !['(idle)', '(program)'].includes(item.name)).sort((a, b) => b.ticks - a.ticks).slice(0, 12);
console.log(JSON.stringify({ listMs, rows: rows.length, requests, hottest, memoryMB: Math.round(process.memoryUsage().rss / 1048576) }, null, 2));
