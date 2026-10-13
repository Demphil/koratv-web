# Oracle Gateway Link

## Active Route After Rollback

At the user's request on October 13, 2026, both `stream-api.koratv.click`
and `stream-api.fraja.online` resolve to Njalla at `80.78.30.212`.
The website root DNS records remain on GitHub Pages.

The complete player API path is restored:
browser -> Njalla HTTPS -> SSH forward on 127.0.0.1:3100 -> Oracle gateway.
The player uses the standard HLS loader and one STREAM_API_ORIGIN.
There is no separate PLAYER_MEDIA_ORIGIN or custom relay loader.

The existing `koratv-oracle-tunnel.service` and its health timer are enabled.
The Nginx upstream points to loopback, not the mutual-TLS connection introduced
after the migration. Do not disable the tunnel or its health timer during deploys.

## Preserved Data And Features

Supabase remains on `amnguwuykrxvmwamlpjf.supabase.co`, as explicitly requested.
No database credentials, rows, manual match selections or notice settings were
rolled back or deleted. Current UI, metadata and login fixes are retained.

Provider allocation and prewarm behavior are restored to the pre-migration
logic from the parent of `c96068b`. The European youth competition exclusion
remains. These changes do not increase any supplier's connection allowance.

## HTTPS And Verification

Both public API names share Njalla's Certbot certificate:
`/etc/letsencrypt/live/stream-api.koratv.click/`.
The expanded certificate expires on January 11, 2027 and renews via Certbot.
Nginx serves HTTP ACME challenges from `/var/www/certbot`.

The direct Oracle public listener is retained for clients with old DNS caches.
Do not switch the DNS back to Oracle without explicit user authorization.

Verify both DNS names, HTTPS certificates, authenticated playlists and complete
segments. A successful health request alone is not a playback test. Back up
the exact assets and proxy configuration before any future rollback.
