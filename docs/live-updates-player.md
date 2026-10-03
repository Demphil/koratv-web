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
