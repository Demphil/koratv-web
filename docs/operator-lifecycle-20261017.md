# Operator Match Lifecycle and Provider Takeover

## Incident

On 2026-10-17 the Kooora worker parsed fresh fixtures but failed before persistence:
`Cannot safely merge current match snapshots (network)`.
A server-side read reproduced `UND_ERR_HEADERS_OVERFLOW` with 77 Arabic match IDs in
one PostgREST IN filter; the same read with 15 IDs succeeded. The newest stored
Kooora snapshot was 07:39 UTC although the worker continued running.

The merge now limits each read to 4,000 encoded ID characters and 20 IDs, retaining
compare-and-swap updates and failing closed if any batch fails. Scheduled sync has
subsequently stored 99/99 snapshots successfully. No credentials or schema changed.

## Controls

- `matches/refresh`: authenticated, CSRF-protected, serialized metadata job. Its
  metadata worker fetches Kooora only, without API-Football calls. The gateway then
  refreshes snapshots and reconciles normal resource preparation; unsaved UI edits
  are preserved. Supplier-link renewal remains a separate control.
- Explicit provider takeover requires the current owner IDs confirmed by the
  operator. Changed owners reject stale requests. Busy choices show their match
  names instead of being disabled.
- The one-slot supplier is probed exclusively. A failed probe restores the old
  demand. Successful transfer pauses displaced fixture identities for the Morocco
  day, so automatic assignment and old HLS sessions cannot reclaim the supplier.
  Assigning a provider to the displaced match resumes it. Failed assignment rolls
  back affected reservations and pauses. Unrelated channel versions are unchanged.
- Source-confirmed finished fixtures stop playback and release their media demand,
  including real viewers. Results remain visible through 23:59:59 Morocco time.
- Windows atomic state replacement retries bounded transient EPERM/EBUSY/EACCES;
  an EPERM failure was reproduced in the full test suite before the change.

## Verification

- Gateway: 233 tests passed in five consecutive full-suite runs.
- Metadata worker: 68 tests passed.
- Tests cover bounded Arabic IDs, failed reads, metadata refresh, takeover owner
  conflicts, rollback, resume, feed aliases, peer isolation, and finished-viewer release.
- Local UI: 1366x900 and 390x844, no horizontal overflow; channel draft survives
  metadata refresh; ended buttons disabled and busy provider choices enabled.
- Live APIs for both frontend origins: 41 fixtures, 17 ended, zero ended fixtures
  advertising streaming at the post-deployment check.
- The live authenticated refresh job completed, displayed its last-refresh time,
  and preserved the existing session. Busy supplier options are enabled and show
  the owning match names. No live provider was taken away solely for QA.

## Deployment Boundary

Backup: `/opt/koratv/backups/operator-lifecycle-20261017`.
Updated only the Kooora worker files and named gateway/operator modules. Restarted
the metadata cron once and reloaded the single-fork gateway once; a brief player
reconnect is expected. DNS, SSH transport, Supabase project, player/HLS assets,
provider credentials, channel inventory, and the mobile application were untouched.
Do not restore the operator-control backup over newer operator choices without
checking them first. The original browser tab with an unsaved channel draft was
left intact; live UI verification used a separate authenticated tab.
