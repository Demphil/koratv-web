# Kora Fabor Static Frontend

Deployment verified on 2026-11-01. This document covers the public frontend only.
Oracle application, playback, provider reservations, credentials, and Fraja were not changed.

## Live Ownership

- Canonical site: https://korafabor.pro/
- Njalla address: 80.78.30.212, existing NGINX; no additional persistent Node server.
- Root and www DNS point to Njalla. HTTP and HTTPS www redirect to canonical HTTPS.
- Certificate expires 2027-01-30 and uses the existing Certbot renewal setup.
- Public releases: `/var/www/korafabor/releases/<version>`.
- Atomic serving pointer: `/var/www/korafabor/current`.
- NGINX source: `/opt/korafabor/korafabor-site.conf`.
- Active configuration: `/etc/nginx/sites-available/korafabor`.
- Public matches and broadcast-events have exact proxy routes. Operator and general
  gateway API routes are not exposed through this frontend. Cookies and authorization
  are not forwarded by these public reader routes.

## Publication And Resource Limits

`kora-static-publish.timer` runs twice an hour, at UTC minute 07 and 37 with jitter.
It invokes a locked oneshot service under the unprivileged `kora-static-site` user.
The publisher slice caps CPU at 15% and memory at 256 MiB. The successful complete
build took about 7m37s with a measured peak of approximately 162 MiB. This is an
observation, not a guarantee of future usage. No new Supabase service key is needed.

- Runtime controller: `/opt/korafabor/korafabor-publish.mjs`.
- Source: `/var/lib/korafabor-publish/work`.
- Durable source archives: `/var/lib/korafabor-publish/state-current`.
- Last result: `/var/lib/korafabor-publish/last-publication.json`.
- Three releases and three source states are retained; publication refuses to start
  below 2 GiB available disk space. A failed build leaves the serving pointer intact.
- The internal source archive retains the original source origin. The migration
  stage rewrites the public artifact and checks canonical URLs, sitemap entries,
  archive references and checksums before promotion. This is intentional.

Read-only checks:

```sh
systemctl status kora-static-publish.timer
systemctl status kora-static-publish.service
cat /var/lib/korafabor-publish/last-publication.json
journalctl -u kora-static-publish.service -n 40 --no-pager
```

An explicit publication uses `systemctl start kora-static-publish.service` and the
same resource constraints. Do not run a concurrent build by hand. Source updates
must be copied to the scoped work tree; the runtime does not automatically git pull.
The staging helper requires a completed original-profile `_site` before packaging.
Do not seed it with an already migrated artifact.

For rollback, stop the publisher timer, verify a retained version's files, and
atomically repoint `current` to that version within the releases directory. Keep
the source-state pointer paired with its original publication, and restart the
timer only after validation. Never alter the unrelated streaming NGINX virtual hosts.

## Verification

- Latest verified release: `1793563766289`.
- 2046 HTML files; 490 internal news pages; 1142 main sitemap URLs; 4 news sitemap URLs.
- Syndicated source briefs remain noindex. Only reviewed articles enter the article sitemap.
- Public matches returned 31 records; browser rendered 20 eligible cards at test time.
- Public SSE delivered a control event; operator paths and unknown pages returned 404.
- Final read-only SEO crawl: 20 pages, 0 errors, 27 length-related advisory warnings.
- Frontend regression suite: 88 tests passed.
- These checks do not prove Google indexing, rankings, backlink authority, or traffic.

## Pending Old-Domain Redirect

`koratv.click` has NOT been redirected. Namecheap access is blocked by the owner's
authenticator recovery issue. One recovery email was sent from the authorized Gmail
address to `accountaccess@namecheap.com` and confirmed in Sent. No identity documents,
passwords or authentication codes were sent. Support approval and 2FA reset are not
confirmed. Do not submit a duplicate recovery request without checking the reply.

After access is restored: verify the new site again, change only the old website's
root/www DNS as required, prepare the appropriate old-domain HTTPS virtual host, and
apply path-preserving permanent redirects. Do not change `stream-api` records or the
existing shared certificate SANs. Verify real old-to-new redirects before submitting
a Search Console change of address. The two old Pages publication workflows are
disabled; retain the old artifact and repository for fallback until migration closes.
