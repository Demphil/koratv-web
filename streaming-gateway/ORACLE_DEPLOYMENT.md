# Production topology

`fabor.sbs` player documents and assets are served by Nginx on Njalla. Its API routes and `stream-api.koratv.click` forward over a restricted SSH tunnel to `127.0.0.1:3100` on Oracle. Only Oracle runs the gateway, account checks, IPTV catalogs, segment cache and provider connections.

Oracle runs `ecosystem.oracle.config.js` from a versioned release. `/opt/koratv/current` points to that release. Existing checkouts are preserved. Gateway configuration, credentials, catalog and account status are private files under `/etc/koratv`; release `.env` links to `gateway.env`. Njalla must not run another provider pool.

The Njalla service is `koratv-oracle-tunnel.service`. Its dedicated key on Oracle is restricted to forwarding to `127.0.0.1:3100`, with no shell session. Nginx remains responsible for HTTPS and original client forwarding. Neither public DNS nor the fabor.sbs certificate moves to Oracle.

## Accounts

Slots A through G permit one upstream channel per independent account. Backup hosts do not add capacity. Provider metadata, not a local date, determines expiration. `provider-credentials.json` maps provider IDs to objects with `username`, `password`, `origins` fields; keep mode 0600 and never commit it. The catalog sync runs every ten minutes on Oracle and retains prior data when a provider fails.

Read current status on Oracle with `sudo cat /etc/koratv/accounts-status.json`. `max_connections` is the provider-reported limit; `gateway_slots` is the configured one-slot-per-account policy. Expired or quarantined accounts cannot be counted as available capacity.

## Six-screen diagnostic

Run from `/opt/koratv/current/streaming-gateway`:

```sh
node --env-file=.env scripts/multiview-link.js
```

This prints a private link valid for 24 hours. The page is hosted on Njalla at `/multiview.html`. The fragment access token is removed from the address bar and kept in tab session storage. API authorization is required before any account identity or HLS session is returned. Screen sessions last one hour; reload using a valid access link to renew them.

The six screens use normal gateway leases and cached segments. They share already watched channels and cannot evict a different channel with active viewers. Status distinguishes manifest sequence, completed segment downloads, HTTP status, and actual video clock progress. Catalog/API authentication success does not prove media playback. Closing the page releases diagnostic viewers through the normal 15-second idle lease timeout.
