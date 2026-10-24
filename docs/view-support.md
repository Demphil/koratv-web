# Viewing-page advertising support notice

The shared fabor.sbs viewing documents, including watch.html embeds, load an
isolated view-support.js module and view-support.css. It does not change the
stream session, provider, video source, sound, pause state or HLS recovery.

## Detection and persistence

- A hidden cosmetic bait is inspected for extension-applied hiding.
- A harmless first-party ads/prebid-ads.js probe reports execution using a
  short random marker. It makes no advertising or tracking requests.
- A separate first-party HEAD request verifies server connectivity. Failed
  connectivity or a timeout is unknown, not evidence of an ad blocker.
- Real Monetag script load/error results are also observed. This covers
  network-only blockers such as AdGuard configurations that allow first-party
  test files and cosmetic bait but reject the external SDKs. No additional
  advertiser requests are made for detection.
- Failed SDK loads are described as unavailable advertising, not proof of a
  particular extension: a provider outage can also produce a load error.
- Server CSP violations are excluded from new provider-failure evidence.
- Two consecutive blocked samples are required for a new notice. Two
  consecutive healthy samples are required before removing one.
- A confirmed requirement is stored for up to one hour. Refresh restores it;
  there is no dismissal flag or close button. Storage denial falls back to
  fresh detection and does not prevent playback.
- Recheck never reloads the page. Healthy results can clear the notice
  automatically. Checks coalesce and run at most every 30 seconds in stable
  visible playback, with one 1.5-second follow-up for confirmation.
- The real Recheck gesture may retry only SDK tags whose network load failed,
  with a five-second retry limit. Successfully loaded SDKs are never duplicated.
  A provider-related requirement cannot clear from local tests alone while
  actual provider tags are pending or not yet attempted after refresh.

The notice appears only after actual video playback has started, so it does
not hide an initial connection error or prevent the first Play gesture. The
video continues behind the overlay. The panel mounts inside the Plyr root
for custom fullscreen support, including ordinary iframe embeds. Its own
controls are excluded from Popunder clicks and do not bubble playback shortcuts.

Client-side code cannot guarantee detection of every blocker or resist a user
who disables/modifies the page's JavaScript. Browser-owned native video fullscreen
can also omit HTML overlays. No universal or tamper-proof guarantee is claimed.

## Local testing without real ads

    npm --prefix streaming-gateway run build:player
    cd streaming-gateway
    node --test test/view-support.test.js
    node scripts/view-support-lab.js

The lab serves a moving synthetic video, the real Plyr controls and notice,
and simulated blocked/allowed local probes. Its network=1 mode keeps cosmetic
bait and the first-party probe healthy while refusing local SDK fixtures. It
uses the production tag loader with all destinations replaced by localhost.
It never opens real ad URLs or calls
streaming APIs. Its blocked mode and toggle are lab-server behavior only,
not production query parameters or a production bypass.

Before publication verify: blocked notice, video time/frame progress, refresh
persistence, recheck while blocked, healthy recovery without reload, small
viewports, iframe embedding, and custom fullscreen. A phone-sized desktop
viewport is layout emulation, not a real-phone validation.

Publication uses the existing isolated static workflow, backs up both HTML
documents and changed assets, checks the current hashes before replacement,
and preserves core playback file hashes. No gateway/nginx/service restart.
Rollback for this feature should use its own deployment run's complete backup.

References:
- https://adguard.com/kb/general/ad-filtering/create-own-filters/
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
- https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
