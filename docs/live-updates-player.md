# Live Match Coverage Without a Stream Resource

Both sites open an exact live match ID on the shared player, even when no video
source is prepared. The player reads `/api/match-info` before starting a viewer
session. A live match with `sourceReady: false` enters text coverage without
calling token, heartbeat, playlist, or resource endpoints.

The public metadata includes `viewingMode` and a safe `resourceStatus`; provider
IDs, credentials, and stream URLs remain private. A current `WAITING` assignment
gets the eight-priority-matches explanation. Other unavailable sources get an
accurate temporary-unavailability message, not a false capacity explanation.

The existing match card refreshes every 15 seconds while the tab is visible.
Events, lineups, and standings depend on upstream data availability. Missing
events are explicitly marked as pending. At full time, the page shows a match
summary; if an assigned source becomes ready, a button offers video playback.

The animated arrow scrolls to and focuses the information panel. Reduced-motion
preferences are honored. Text coverage also reveals the panel inside embeds,
without altering normal video embed layout or removing integrity protection.
The video click-ad shield is not added over text coverage; ad URLs are unchanged.

Validation:

- `npm --prefix streaming-gateway test`
- `npm --prefix streaming-gateway run build:player`
- `node scripts/test-live-updates.cjs`

The browser test uses synthetic match metadata, checks 1366, 390, and 320-pixel
viewports, captures standalone and embedded screenshots, and rejects any
streaming-session or provider-resource request in text mode.

Production verification on 2026-10-03:

- Gateway/player deployment: Unified Data Refresh run `37146512256`, all jobs passed.
- Fraja static deployment: run `37146503817`, passed.
- Both public frontends provided exact-ID links for an unprepared live fixture.
- Desktop and mobile text coverage appeared in 985-1384 ms, refreshed its
  metadata, had no horizontal overflow, and issued zero streaming-resource calls.
- Current unprepared fixtures had no upstream event details yet; the player
  explicitly showed the pending-data message instead of inventing events.
- A separate prepared Spain/Czechia broadcast decoded 1187 frames over a
  49-second smoke test, with all playlist and media responses successful.
  This is not a full-match reliability guarantee.

`node scripts/audit-live-updates.cjs` repeats the public read-only checks.
