# Six-account pool

Production runs exactly one `koratv-gateway` process. Do not increase PM2 instances: the in-memory scheduler, leases, singleflight cache and account queues belong to that process.

- Each account owns at most one match; viewers share the same upstream and cached segments.
- Score = highest matching tier + 20 per signed HLS viewer session active in the last 20 seconds. Repeated segment requests do not multiply viewers.
- A match with no activity for 15 seconds releases its slot. Equal scores preserve existing leases. A strictly higher score can replace a lower score; old network requests are aborted before the provider queue runs the new lease.
- HTTP 403 cools down that account for 30 seconds. Failover only uses a free compatible account. It never steals the other live account as a failover action.
- Capacity returns 503 and `Retry-After: 3`; reassignment returns 409. The player retries the same match, never an unrelated match.
- One fixed upstream URL per account/channel, one HLS rendition (720p preferred). Alternate DNS names are not extra accounts.
- Accounts A through F have no local expiry deadline. Update the corresponding `IPTV_PROVIDER_B_JSON` through `IPTV_PROVIDER_F_JSON` secret and deploy to replace secondary credentials. Viewer token and manual override expiry remain separate.
- Imported sports catalog and credentials stay in `/etc/koratv/provider-catalog.json` (0600), outside Git and the web root.

## Manual broadcast override

Full production path: `/etc/koratv/manual-broadcast-override.json`.

Edit with `sudo nano /etc/koratv/manual-broadcast-override.json`:

```json
{
  "matches": {
    "EXACT_MATCH_ID_FROM_API": {
      "channel": "beIN SPORTS HD 1",
      "enabled": true,
      "expiresAt": "2026-09-28T20:00:00Z"
    }
  }
}
```

Use the exact `matchId` returned by `/api/matches` and an existing canonical channel name. For the same match on both sites, add both Kooora and API-Football IDs if overriding both. The file is read every 5 seconds, with the last valid JSON kept if an edit is incomplete. Allow up to 8 seconds including the playback resolver cache. No restart is needed. Expired/disabled entries are ignored. Empty `matches` removes all manual assignments. Do not put credentials or stream URLs in this file. The override changes the channel only, not API-Football details or competition filtering. Existing signed sessions whose channel changed must reopen the match.

Priority definitions: `/opt/koratv/koratv-web/streaming-gateway/priority-matrix.json` (version-controlled; deploy changes).

The pool enforces six allowed upstream slots, one channel per independent account. Failover requires a free account that carries the same channel; six occupied slots leave no spare capacity.

## Private account status

Status is atomically written to `/etc/koratv/accounts-status.json` with mode 0600, updated within one second of media responses or allocation changes. Read it with `sudo cat /etc/koratv/accounts-status.json`.

From `/opt/koratv/koratv-web/streaming-gateway`, run `node --env-file=.env scripts/accounts-status.js` for an immediate snapshot. Add `--probe` only to intentionally test six different channels through the running pool for about 30 seconds. Occupied leases are reused, never opened directly outside the account queue. Diagnostic viewers expire after 15 seconds of inactivity.

The CLI uses loopback-only endpoints authenticated by a domain-separated HMAC credential. Forwarded requests and missing credentials are rejected; account usernames, passwords and server addresses are not added to the public health endpoint. Passwords and credentialed stream URLs never appear in the status file.

Actual media 401 or provider metadata auth rejection/Expired/Disabled/Banned isolates the account as `STOPPED_EXPIRED`. A 403 causes a 30-second `COOLDOWN_403`; three failures without successful media increase cooldown to five minutes. Metadata is checked every minute without opening a media connection. A past provider expiry timestamp alone never disables an account. Metadata timeouts do not falsely mark a playing account expired. The file records the latest HTTP code, check time, channel, and reason; a temporary cooldown is not proof of expiry.
