# Match control and workflow audit

## Boundaries

- Keep the new Supabase project, both stream-api DNS records, the Njalla SSH tunnel and existing HLS transport unchanged.
- The console is served by the single Oracle gateway. Its private route remains environment-only.
- A supplier account has one upstream slot. A spare permits testing without pausing the target; testing its own occupied slot may briefly pause that match, never another match.

## Control changes

- Serialize resource-changing jobs, limit the queue to eight, deduplicate retried requests by session and request UUID.
- Renew one match or up to eight selected matches with fresh supplier discovery and media verification before persistence.
- Keep working overrides if verification fails; report per-match batch results.
- Reserve a supplier for a match for the Morocco day; release the reservation when the match ends. Automatic selection remains available.
- Scope playback-cache invalidation, source preparation and channel-version notifications to changed matches. Preserve peer leases and pending editor values.
- Scheduled prewarm waits while an operator resource job runs; viewer keepalives remain active.

## Workflows

Removed from koratv-web: deploy.yml, sync-iptv.yml, sync-matches.yml, repair-provider-media.yml.

Removed from foottv6: deploy.yml, sync-iptv.yml, sync-matches.yml.

The removed workflows used the old Njalla gateway deployment or duplicate Supabase link/match writers. The repair workflow was a one-off runtime deployment.

Unified Data Refresh now only prunes expired snapshots and publishes static pages. It no longer copies the gateway, resets private configuration, restarts PM2, redeploys the player, or overwrites Nginx. Oracle's running Kooora scheduler and supplier scheduler own ingestion and catalog refresh. The previous upload job failed because the SCP container could not read its 0600 API configuration file; that obsolete runtime-upload chain has been removed, not worked around by exposing the key.

Retained koratv-web: accounts-check (corrected to Oracle, no disruptive probe option), api-football-audit, indexnow, manual-matches, performance-audit, publish-site, runtime-diagnostics, sync-data.

Retained foottv6: indexnow, publish-site. Static publishing now has a four-hour schedule, without a duplicate backend writer.

## Validation

- Gateway suite: 231 passing tests, including queue deduplication, partial renewal, provider exclusivity, bilingual reservation aliases and scoped supplier switching with an untouched peer lease.
- Parsed all ten retained workflow definitions and checked job dependency references.
- Local fixture UI checked at 1366x900 and 390x844; no horizontal control overflow. Supplier change and renewal controls were exercised without contacting real suppliers.
- Deployed only eleven gateway/control/UI files; retained a backup at /opt/koratv/backups/operator-control-20261013-1791926610. One controlled gateway reload was required. The final UI-only adjustment required no reload.
- Both stream-api HTTPS health endpoints returned 200. Public JS/CSS hashes matched local files; unauthenticated operator state returned 401.
- The authenticated live console displayed the user-selected supplier B for FUS Rabat vs Raja, a successful completed job, the reservation and its verification time. No real match or supplier was changed by the agent for this verification.
- Seven removed workflow definitions were disabled before removal and no longer appeared in the active workflow inventory after push.
- GitHub runs succeeded: koratv-web Unified Data Refresh 38470577822, foottv6 static publication 38470589795, Oracle account inspection 38470616330.
- The frontend excludes completed fixtures from batch renewal and disables their resource-changing actions without removing their result cards.
