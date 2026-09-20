# Njalla VPS first-time setup

Run these commands once as `root` on Ubuntu 24.04:

```bash
apt-get update
apt-get install -y ca-certificates curl git redis-server build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install --global pm2

systemctl enable --now redis-server
redis-cli ping

install -d -m 0755 /opt/koratv
git clone https://github.com/Demphil/koratv-web.git /opt/koratv/koratv-web
cd /opt/koratv/koratv-web/streaming-gateway
npm install --omit=dev
cp .env.example .env
chmod 600 .env
node scripts/setup-env.js
nano .env

npm test
npm run build:player
cd /opt/koratv/koratv-web
pm2 start ecosystem.config.js --env production
pm2 startup systemd -u root --hp /root
pm2 save
curl --fail http://127.0.0.1:3100/healthz
```

Keep `streaming-gateway/.env` only on the VPS. It is ignored by Git and survives every `git pull` deployment.
