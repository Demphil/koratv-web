import { createHmac } from 'node:crypto';

if (!process.env.HMAC_SECRET) throw new Error('Run with --env-file=.env from streaming-gateway');
const token = createHmac('sha256', process.env.HMAC_SECRET).update('koratv-account-admin-v1').digest('hex');
const probe = process.argv.includes('--probe');
const base = `http://127.0.0.1:${process.env.PORT || 3100}`;
const started = Date.now();
for (let round = 0; round < (probe ? 10 : 1); round++) {
  if (round) await new Promise(resolve => setTimeout(resolve, Math.max(0, started + round * 3000 - Date.now())));
  const response = await fetch(`${base}/internal/accounts-${probe ? 'probe' : 'status'}`, {
    method: probe ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0 AccountDiagnostics' }, signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`Local account diagnostic HTTP ${response.status}`);
  const data = await response.json();
  console.log(JSON.stringify({ round, elapsed_ms: Date.now() - started, ...data }));
  if (probe && (!data.results.length || new Set(data.results.map(r => r.channel)).size !== data.results.length || data.results.some(r => r.error || r.manifestStatus !== 200 || r.segmentStatus !== 200 || !r.bytes))) {
    process.exitCode = 1; break;
  }
}
