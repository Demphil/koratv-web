const path = require('node:path');
module.exports = { apps: [
  { name: 'koratv-oracle-watch', cwd: path.join(__dirname, 'streaming-gateway'), script: 'server.js', interpreter: 'node', node_args: '--env-file=.env',
    instances: 1, exec_mode: 'fork', autorestart: true, kill_timeout: 12000, max_memory_restart: '1536M', env: { NODE_ENV: 'production' } },
  { name: 'koratv-provider-pool-sync', cwd: path.join(__dirname, 'streaming-gateway'), script: 'scripts/provider-pool-cron.js', interpreter: 'node', node_args: '--env-file=.env',
    instances: 1, exec_mode: 'fork', autorestart: true, env: { NODE_ENV: 'production' } }
] };
