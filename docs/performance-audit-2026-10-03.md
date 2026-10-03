# Production performance audit - 2026-10-03

## Scope and topology

Audited the content-to-playback path in `koratv-web` and `foottv6`, their published
GitHub Pages frontends, the Njalla nginx/player/SSH tunnel, and the deployed Oracle
gateway, Supabase readers, provider pool, cache, refresh jobs, and PM2 inventory.
This is not a claim that every historical file or every browser has been tested.

- Frontends: koratv.click and fraja.online.
- Player and public embeds: fabor.sbs.
- Shared API: stream-api.koratv.click, forwarded through Njalla to Oracle.
- Database: shared Supabase matches/channels; private credentials stay server-side.
- Provider accounts: existing assignment, single-account serialization and fencing remain enforced.

## Measured root causes

1. Repeated alias normalization and fuzzy channel searches blocked the Node event
   loop. A production list of only 37 matches took 21,188 ms inside the reader,
   whereas individual database reads took 87-128 ms. Oracle gateway CPU was 104.3%
   in that sample. This was primarily application work, not slow Supabase or a
   demonstrated need to buy a larger server.
2. Concurrent frontend calls for today and tomorrow reset the pending-promise
   cache, producing two identical, slow `/api/matches` requests on first entry.
3. Playback repeatedly rediscovered provider links despite prepared assignments;
   cache lifetimes started before slow operations completed. Prewarm heartbeat and
   media-cache keys did not match the keys used for real viewers.
4. Frontends opened an `about:blank` window and waited for ticket creation before
   navigating. Slow backend work therefore presented a blank or failed page.
5. The 619,692-byte HLS runtime had no compression or reusable browser caching.
6. Nested server retries blocked the account queue longer than player deadlines.
   One transient segment failure could remove the shared lease for all viewers.
7. Player readiness was based on manifest/segment receipt, not decoded video
   progress. A longer test exposed a silent stall despite HTTP 200 responses;
   the old reconnect path could remain at time zero with an apparently successful
   buffer. This observation is distinct from proving the original media fault.
8. Urgent source replacement kept the previous manifest base URL for relative
   segments, potentially loading the old resource path after renewal.
   The instrumented live test also caught media sequence 935 dropping to 361,
   followed by `bufferAppendNoProgress` and a negative HLS timeline edge. The
   gateway had appended the restarted source without fencing the previous viewer
   timeline. This is direct evidence of a continuity fault in our relay logic.
9. Bilingual fixture IDs could occupy separate workers for the same event; a known
   broadcaster could be advertised as playable before its assigned resource was ready.

## Implemented fixes

- Compile/index channel identities once per changed catalog, cache bounded lookup
  results, and keep the last valid catalog during a partial file write.
- Coalesce shared database reads with bounded stale-while-revalidate snapshots;
  prime them at gateway startup. Cache age begins at successful completion.
- Use prepared, exact-assignment provider links. Keep explicit urgent renewal and
  periodic refresh, without forcing discovery on each viewer request.
- Share pending frontend requests; navigate directly to the existing player route
  with the exact match ID. Mint/redeem protected viewer tickets inside the player.
- Align prewarm and playback segment keys and heartbeat the actual pool lease.
- Compress/cache versioned static assets; keep documents, credentials and APIs out
  of public reusable caches. HLS resources remain protected by viewer authorization.
- Let HLS own media retries; retain healthy shared leases on isolated transient
  failures. Count failures once per upstream operation, not once per viewer.
- Use actual clock/frame progress for silent-stall recovery, bounded reconnection,
  and preserve playback intent during reconnection. User pause/background state
  does not trigger the progress watchdog. Successful downloads do not cancel the
  initial readiness deadline.
- Resolve relative segments against the renewed final manifest URL.
- Rotate media descriptor identity on source replacement and maintain a per-viewer
  timeline epoch. Sequence regression causes one protected 409 reset handshake,
  not provider quarantine or appending the new encoder to old MSE timestamps.
  Fence resource reads that were in flight during a source replacement.
- Distinguish a non-overlapping encoder restart from an older overlapping playlist
  delivered late by concurrent readers. The latter does not change the epoch or
  repeatedly restart viewers. Reuse the final media playlist destination within
  the lease; if it expires, retry the provider entry once before account failover.
- Group exact bilingual fixture aliases under one worker; retain manual selection
  and exact broadcaster variants. Only prepared resources are advertised as ready.
- Keep authoritative backend playback lifecycle on both frontends; fix mobile
  horizontal overflow. Add protected native-HLS playback for compatible browsers.
- Back up Oracle gateway files and Njalla player/nginx files before deployment.

Existing secrets, provider accounts, ad links, embed paths and security boundaries
were not deleted or replaced. The pre-existing untracked provider audit script
was not modified or deployed.

## Measurements

Fresh browser contexts, Chromium cache disabled, actual public deployments,
desktop 1366 px and phone-sized 390 px viewports. No simulated bandwidth limit.

| Measurement | Before | After first/second deployment |
| --- | --- | --- |
| External matches response | 13.73 s; overlapping requests exceeded 40 s | 0.59 s sample |
| Production cold list computation | 21,188 ms | 261-301 ms audit samples |
| Shared warm list computation | repeated work | below 1 ms sample |
| Kora first visible match cards | 15.46 s | 0.86-1.80 s |
| Fraja first visible match cards | still pending after 45 s | 0.86-1.21 s |
| Initial matches requests | 2 on Kora | 1 on both sites |
| HLS runtime transfer | 619,692 bytes | 226,107 gzip bytes |
| First video-frame counter progress | not reliably opening | 3.3-4.6 s samples |
| 10 simultaneous shared list reads | not measured | all HTTP 200, maximum 547 ms |

A desktop playback test advanced frames for 90 seconds. A later 4-minute test
exposed a silent stall, so it was not counted as a stability success. An instrumented
repeat advanced 7,508 frames for 150 seconds with manifest sequences increasing
from 279 to 294 and no HLS error event. A subsequent probe exposed repeated false
timeline resets caused by overlapping late playlists; these were fixed rather
than counted as a success.

The final b1d006e production probe ran for 303 seconds at a 390 px viewport on the
UAE/Oman fixture, with an intentional reconnect at 63 seconds. Playback resumed
automatically, then advanced to 5,956 frames after the decoder reset. The last
sample had readyState 4, currentTime 258.05, and 31.95 seconds of buffered video.
Manifest sequences advanced from 2368 to 2397. All 31 playlist responses and all
37 media responses were HTTP 200; no unplanned 409/503 reset or HLS error was
captured. The screenshot showed actual football video and a fitted player/match
panel. This is a bounded live result, not a full-match or all-device guarantee.

## Verification and deployment evidence

- Gateway unit/integration tests: 122 passing, 0 failing after the continuity fix.
- Player build and git whitespace check passed.
- Tests cover pending-reader coalescing, cache expiry, exact assignment, bilingual
  aliases, prepared-source reuse, isolated/persistent upstream failures, native HLS,
  public embed identity, authorization boundaries, decoded-progress recovery and
  relative resource paths after urgent renewal.
- Full releases: Kora e5fc08a / ecda466; Fraja 823c2e1 / 8afcc97.
- Unified deployments: 37141508521 and 37142660313 completed all four jobs.
- Production audit 37142820725 completed both Oracle and Njalla jobs successfully.
- Recovery release: Kora 6aeaba1; deployment 37143764450 completed all four jobs.
- Timeline continuity release: Kora b1e2ba5; deployment 37144340012 completed all four jobs.
- Overlapping-playlist/final-destination release: Kora b1d006e, deployment
  37144993794 completed all four jobs.
- Final production audit 37145343803 passed both server jobs: Oracle loopback
  response 24 ms, Njalla tunnel total 155 ms. Sampled gateway CPU 5.6%, RSS 606 MB
  during active playback/cache use; Njalla tunnel NRestarts 0. These are sampled
  values, not peak-load guarantees.
- Live-browser probe: `scripts/audit-live-performance.cjs`. It logs HLS sequence,
  decoded frame progress and status without viewer/provider tokens or resource URLs.

## Remaining boundaries and operational risks

- Phone viewport checks are not physical Android/iPhone tests. Native Safari HLS
  is unit-tested, not verified on an actual iPhone.
- Midnight rollover, a full-match endurance test and peak-viewer concurrency were
  not verified by these short production probes.
- Oracle still runs two historical npm jobs from the legacy secure-streaming
  directory, alongside the current provider-pool refresh and gateway. Their low
  sampled CPU does not explain the measured list bottleneck. Their full deployed
  implementation was not migrated in this performance release.
- Fraja retains a separate scheduled Supabase sync workflow. Independent writers
  are an operational drift/race risk; do not equate this with a proven cause of
  the observed decoder stall. Consolidating writer ownership needs verified
  deployed job definitions and a rollback plan, not deleting old files blindly.
- A single prepared rendition cannot provide adaptive bitrate choices that the
  supplier does not publish. No unsupported promise of large-company CDN scale
  or permanently interruption-free streaming is made.

## Primary references

- Node.js event-loop guidance: https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop
- Official HLS.js API, live buffering and recovery: https://github.com/video-dev/hls.js/blob/master/docs/API.md
- HLS format and timeline/discontinuity rules: https://www.rfc-editor.org/rfc/rfc8216
- HTTP caching rules: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- Critical-path loading: https://web.dev/articles/optimize-lcp

The implementation follows these documented mechanisms. Measurements above come
from this deployment, not from claims made by those sources.
