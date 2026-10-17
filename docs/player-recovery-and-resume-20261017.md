# Player Recovery and Resume Repair

## Scope and Deployment

- No gateway, proxy or media worker restart. Gateway PID remained 1692969 during rollout.
- No DNS, Supabase project, provider credentials or HLS library/configuration change.
- The resource assignment CLI and operator UI are loaded as files, so their fixes activate without restarting active streams.
- The new player bundle activates on subsequent player loads. Already open unrelated players are left untouched.

## Resume Defects

- Paused assignment rows were deferred without `priorityScore`. Bulk persistence could consequently send a missing value to the non-null integer `priority_score` column.
- Paused plans now contain a score; persistence also normalizes legacy missing or non-finite scores to an integer.
- The resume UI previously submitted only a match ID, losing channel/provider edits. It now submits those choices through the existing verified channel operation with explicit resume intent.
- A resume does not automatically take over an occupied supplier. The UI also rejects a resume when all eight resources are assigned.
- The player now exits statistics-only mode on a verified operator resume, restores the refresh control and watchdog, and remembers whether the viewer had been playing before the administrative stop.

## Automatic Playback Recovery

- HTTP 409/503 and expired viewer sessions enter a bounded-rate recovery loop instead of requiring a page refresh.
- The player polls existing match metadata while the gateway's existing background preparation validates and repairs the same canonical channel.
- It reconnects its HLS instance only when readiness returns, and renews expired credentials for the exact current match.
- Retries back off from three to fifteen seconds. They do not trigger per-viewer catalog discovery or allocate another match's resource.
- Manual stops and authoritative match endings exit recovery into statistics-only coverage.
- Supplier outages can still require a wait while the periodic source check and alternative probe finish; this is not a promise of gapless playback.

## Verification

- 262 gateway tests passed, including missing paused priorities, draft-aware resume, peer preservation, automatic reconnect, session renewal and statistics-to-video transitions.
- Production resume of Club Omnisports de Meknes vs Union Touarga succeeded using the operator's Arryadia HD/provider I selection.
- The public API changed from paused/not-ready to assigned/ready; the resumed player decoded video with readyState 4.
- An independent Barcelona player remained playing through deployment and resume, advancing from 20 to over 220 seconds without navigation.
- HLS library and API configuration SHA256 hashes remained unchanged. Private rollback archives were created on both hosts.
- A CDP offline simulation affected only the agent's resumed-match tab: 15 manifest requests, nine metadata requests and 27 heartbeats failed with ERR_INTERNET_DISCONNECTED.
- After restoring that tab's network, video resumed automatically with readyState 4 and no Page.frameNavigated events. The independent Barcelona tab kept playing and advanced beyond 418 seconds.
- Both public origins subsequently reported the resumed fixture as assigned/ready and not paused. No supplier outage was induced in production.
