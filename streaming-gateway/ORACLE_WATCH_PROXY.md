# Oracle Cloud watch proxy

This deployment mode keeps Njalla/GitHub Pages responsible for the public site
and match API, while Oracle Cloud becomes the watch proxy that talks to IPTV.
It does not install or run FFmpeg.

## Request flow

1. `fraja.online` or `koratv.click` loads matches from the existing gateway.
2. The frontend requests an entry ticket from the gateway.
3. The browser opens `https://medic.cymru/739184.html?k=...`.
4. `medic.cymru` on Oracle redeems the entry ticket.
5. Oracle reads the channel source from Supabase, stores an opaque session in
   Redis, fetches the IPTV HLS playlist, rewrites every playlist/segment/key URL
   through `/api/resource`, and sends only proxied URLs to the browser.

The browser never receives the raw IPTV URL. Oracle is only a secure HLS
pass-through proxy; quality variants are the provider's native HLS qualities.

## Why IPTV streams usually cut

- The provider rotates or expires channel URLs.
- The first URL is a master playlist but the player chooses a bad variant.
- Segment or key hosts are different from the playlist host and are not in
  `UPSTREAM_ORIGINS`.
- The provider requires a stable User-Agent or blocks a data-center route.
- Live playlists update slowly or have discontinuities during sports peaks.
- Network geography matters; a VM route that worked before can be more stable
  than another VPS provider for the same IPTV origin.

## Recommended split

- Keep `fraja.online` on GitHub Pages as a static frontend.
- Keep `stream-api.koratv.click` on Njalla for match JSON and token creation if
  it is already stable.
- Point `medic.cymru` to Oracle Cloud for the player and HLS proxy if Oracle had
  better IPTV routing.
- Use the same `JWT_SECRET`, `HMAC_SECRET`, Supabase settings, Redis behavior,
  and client-IP proxy settings on both gateways.

If token generation stays on Njalla and redemption happens on Oracle, both sides
must hash the same client IP. Do not put a new proxy/CDN in front of only one
side unless `TRUSTED_PROXIES` and real-IP handling are updated identically.

## Oracle install outline

```bash
sudo apt update
sudo apt install -y nginx redis-server certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

cd /opt/koratv/koratv-web/streaming-gateway
npm ci --omit=dev
cp .env.oracle.example .env
# Fill secrets and upstream origins. Do not commit .env.
npm run build:player
sudo mkdir -p /var/www/koratv-player
sudo cp -r dist/* /var/www/koratv-player/
pm2 start server.js --name koratv-oracle-watch
pm2 save
```

Enable `nginx.oracle.conf.example` after replacing certificate paths with the
real `medic.cymru` certificate, then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Sports-only link renewal

`secure-streaming/scripts/sync-iptv-provider.js` keeps the sync sports-only by
default with `IPTV_SYNC_ONLY_SPORTS=true`. It matches provider entries to the
existing Supabase channel names, updates `channels.original_url`, and stores
native HLS qualities in `channels.quality_variants`.

Useful tuning variables:

```bash
IPTV_SYNC_ONLY_SPORTS=true
IPTV_VALIDATE_STREAMS=true
IPTV_SYNC_MASTER_QUALITIES=true
IPTV_SYNC_CANDIDATES_PER_CHANNEL=8
IPTV_PROVIDER_PROBE_CONCURRENCY=6
IPTV_MASTER_PROBE_CONCURRENCY=4
IPTV_MASTER_PROBE_TIMEOUT_MS=8000
```

Run a dry plan before updating Supabase:

```bash
cd /opt/koratv/koratv-web/secure-streaming
npm run sync:iptv:dry
npm run sync:iptv
```
