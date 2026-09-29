# Unified daily data refresh

`.github/workflows/sync-data.yml` is the only scheduled GitHub Actions data refresh.
It runs at 22:59 UTC and is also available through `workflow_dispatch`.

1. Remove match snapshots and language alternatives older than 24 hours. The
   cleanup uses version-checked deletes and leaves the channel inventory intact.
2. Fetch today's and tomorrow's fixtures and their broadcaster names, then
   upsert current match snapshots. A zero-row source result fails before writes.
3. Ask Oracle to refresh its private provider catalog. Each successfully
   discovered account replaces only its own old links. A transient failure
   retains its previous links; an explicitly expired account is disabled.
4. Redeploy the unchanged static GitHub Pages frontend after the data steps.

The Oracle job requires repository secrets `ORACLE_HOST`, `ORACLE_USER`, and
`ORACLE_SSH_KEY`. The key is used only to invoke the existing Oracle sync
script; provider credentials stay in `/etc/koratv` on Oracle. A shared
`flock` lock serializes this invocation with Oracle's ten-minute catalog cron.

The old `sync-matches.yml` and `sync-iptv.yml` workflows remain manually
dispatchable but are no longer scheduled. The latter's job is still disabled.
The ten-minute live match refresh processes are separate from this daily
workflow, because GitHub's daily schedule cannot replace live score updates.

To run the daily sequence manually:

```sh
gh workflow run sync-data.yml -R Demphil/koratv-web
```
