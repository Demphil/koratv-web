# Kooora senior Champions League completeness

## Verified cause

Kooora listed nine senior Champions League fixtures on 14 October. The sites returned only six. Roma vs Real Madrid, Manchester City vs Paris Saint-Germain and Real Betis vs Porto shared the same legacy team/day identifier as their youth fixtures. Stored records for these identifiers had the youth competition, youth source event ID and afternoon kickoff. The public youth filter therefore hid them.

The match scheduler had started on 12 October at 18:51 UTC, before the youth visibility helper was updated on 13 October at 14:53 UTC. Its loaded modules still admitted youth snapshots, overwriting senior rows every scheduled cycle. Fresh imports from the same files on disk excluded the youth fixtures correctly.

The undated Kooora page also alternated between current-day and previous-day payloads during the audit. Dated fixture URLs returned the intended schedule.

## Changes

- Preserve all senior match IDs and existing stream/operator bindings.
- Namespace youth identifiers by category and immutable source event hash, including manual-search parsing.
- Exclude European youth competitions from ordinary/manual ingestion and from snapshot persistence, independently of the frontend filter.
- Fetch today's dated fixture URL and reject rows outside the requested Morocco date.
- Record a loaded-code fingerprint when the metadata scheduler starts.

## Deployment

Backed up 51 source snapshots and the three affected worker files at /opt/koratv/backups/kooora-completeness-20261014-1791937166.

Updated only sync-matches-from-source.js, operator-match-import.mjs and match-sync-cron.js. Restarted only match-sync-cron. The gateway PID remained unchanged. Supabase project, DNS, channel inventory, supplier reservations and HLS transport were not changed.

The one-off refresh persisted 29 current/tomorrow snapshots. Two leftover youth records were reversibly deactivated using version-checked updates; senior rows were not deleted.

## Verification

- All 66 metadata tests passed, including four new collision/date/import regressions.
- The gateway regression run hit the pre-existing intermittent Windows operator-resource fixture failure (operation_failed during a queued mock job). This test also failed intermittently before this ingestion change; no gateway files were modified or reloaded in this deployment. The gateway suite is not claimed as fully passing for this run.
- A following scheduled cycle refreshed the nine senior fixtures with their correct source IDs and preserved the repair.
- Both public today APIs returned nine senior Champions League fixtures and zero European youth fixtures.
- The eight-supplier limit applies to simultaneous broadcast preparation, not schedule visibility.
