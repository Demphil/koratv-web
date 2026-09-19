module.exports = {
  apps: [
    {
      name: "koratv-gateway",
      cwd: "/opt/koratv/koratv-web/streaming-gateway",
      script: "server.js",
      interpreter: "node",
      node_args: "--env-file=.env",
      exec_mode: "cluster",
      instances: "max",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      listen_timeout: 10000,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
