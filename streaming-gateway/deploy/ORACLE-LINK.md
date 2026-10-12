# Oracle Gateway Link

## Current Public Route

`stream-api.koratv.click` resolves directly to Oracle. Enable
`oracle-public-gateway.conf` there after provisioning the managed
`stream-api-oracle` certificate with Certbot's webroot `/var/www/certbot`.
Install `reload-gateway-certificate.sh` as a Certbot deploy hook. The public route
preserves all existing API authentication, client-IP binding, and CORS policies.
KoraScore AI's virtual host and the static player on Njalla are unchanged.

The direct route avoids the measured packet loss between the two hosts. The
Njalla proxy remains available for clients whose DNS caches have not expired;
do not remove it during the transition. Keep the former DNS address documented
in the deployment record for rollback. Check both authoritative nameservers and
public resolvers, then verify actual video segments rather than health alone.

## Transitional Private Link

The Njalla edge connects to Oracle on HTTPS, with a private CA and mutual
TLS. Each request uses the Nginx upstream pool rather than a shared SSH tunnel.
Oracle accepts the client certificate and the Njalla source IP only. The existing
KoraScore AI virtual host is unchanged.

## Provisioning

1. Run `provision-oracle-link.sh` on Oracle as root. Keep its output archive private.
2. Install the CA and client certificate/key under `/etc/koratv/oracle-link` on
   Njalla, with directory mode 0700 and private key mode 0600. Remove transfer archives.
3. Enable `oracle-gateway-mtls.conf` on Oracle, validate with `nginx -t`, and reload.
4. Validate the private health endpoint using the client certificate, trusted CA,
   TLS name and Host `oracle-gateway.internal` before changing the public edge.
5. Back up the active Njalla Nginx configuration, install the matching example,
   validate, and reload. Preserve the public hostname in `X-Forwarded-Host`.
6. Disable the legacy tunnel watchdog timer. Keep the stopped legacy configuration
   available for rollback; it must not restart the production gateway.

The certificates expire after 730 days. Inspect expiration with `openssl x509
-in client.crt -noout -enddate` during normal certificate maintenance and rotate
both ends before expiry. Never commit keys or place them in the player build.

## Verification And Rollback

Check public HTTPS, authenticated console state, and an actual HLS segment.
Loopback health alone does not prove public playback. Unauthenticated access to
the private TLS endpoint must fail. Inspect logs only with token/query redaction.

To roll back, restore the backed-up Njalla proxy configuration, validate/reload
Nginx, and restore the SSH tunnel if that configuration needs it. Do not restore
the restart watchdog until its effect on active viewers has been reviewed.

## Console Payload

Periodic state includes only current match broadcasters, not the entire provider
catalog. Authenticated channel suggestions return at most 32 names. Match search
returns a background job immediately. Disconnecting the browser neither disables
the saved selection nor cancels the search worker. A gateway restart can interrupt
in-memory jobs; the UI unlocks the search and keeps saved selection and drafts.
