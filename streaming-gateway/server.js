import { createClient } from 'redis';
import { Agent, setGlobalDispatcher } from 'undici';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const upstreamAgent = new Agent({
  connections: Math.max(8, Number(process.env.UPSTREAM_HTTP_CONNECTIONS || 32)),
  pipelining: 1,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  headersTimeout: 20_000,
  bodyTimeout: 30_000
});
setGlobalDispatcher(upstreamAgent);
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', () => console.error('Redis unavailable; token issuance fails closed'));
await redis.connect();
const server = createApp({ config, redis }).listen(Number(process.env.PORT || 3100), process.env.HOST || '127.0.0.1');
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await redis.quit().catch(() => {});
    await upstreamAgent.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => {
    upstreamAgent.destroy().catch(() => {});
    process.exit(1);
  }, 12000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
