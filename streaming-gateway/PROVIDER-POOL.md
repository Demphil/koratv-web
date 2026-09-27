# Three-account pool

Production runs exactly one `koratv-gateway` process. Do not increase PM2 instances: the in-memory scheduler, leases, singleflight cache and account queues belong to that process.

- Each account owns at most one match; viewers share the same upstream and cached segments.
- Score = highest matching tier + 20 per signed HLS viewer session active in the last 20 seconds. Repeated segment requests do not multiply viewers.
- A match with no activity for 15 seconds releases its slot. Equal scores preserve existing leases. A strictly higher score can replace a lower score; old network requests are aborted before the provider queue runs the new lease.
- HTTP 403 cools down that account for 30 seconds. Failover only uses a free compatible account. It never steals the other live account as a failover action.
- Capacity returns 503 and `Retry-After: 3`; reassignment returns 409. The player retries the same match, never an unrelated match.
- One fixed upstream URL per account/channel, one HLS rendition (720p preferred). Alternate DNS names are not extra accounts.
- Accounts A, B and C have no local expiry deadline. Provider authentication failures (401/403) trigger temporary cooldown and failover; expired signed viewer sessions and manual overrides remain protected separately. Update `IPTV_PROVIDER_B_JSON` or `IPTV_PROVIDER_C_JSON` and deploy to replace credentials.
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

The pool enforces three allowed upstream slots, one channel per account. It does not provide six simultaneous channels from three accounts or guarantee availability of a provider's content.
