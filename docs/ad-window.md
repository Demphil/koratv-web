# Publisher ad-window adapter

The adapter in `assets/js/monetag-window.js` is loaded before the existing
Monetag tags. The shared viewing-page build copies this same file into its
static bundle; it does not modify the streaming gateway or provider code.

## Scope and rollout

- KoraTV OnClick zone: 11820367.
- Fraja OnClick zones: 11865231 and 11865230, in its own checkout.
- Shared fabor.sbs player OnClick zone: 11949898.
- Existing DirectLink URLs, other network tags, cooldowns and security flags
  remain in place. Only explicitly configured direct URLs use openDirect.
- The current official al5sm.com tag was fetched as text, not executed. Its
  SHA256 matched the inspected Clipmora source. The decoded Et path creates
  an about:blank iframe and calls its contentWindow.open; Fo/Mo consume the
  onClickExcludes list of actual DOM elements.
- Only Chrome on Windows uses the desktop adaptation. Other browser families
  keep native window.open and iframe insertion methods, not just native args.
- Android Chrome handoff is implemented, but production HTML deliberately uses
  data-mobile-swap="off" until real-device validation for this project.
- The viewing page uses data-mode="player" and cannot replace a viewing tab,
  even if mobile rollout is enabled elsewhere later. Embedded pages, active
  media, file inputs, dirty forms, submitting forms, busy UI and retained
  results also block handoff. Applications may mark additional critical UI
  with data-no-popunder, data-ad-busy="true" or data-ad-keep-result="true".

The desktop path requests popup=yes,width=640,height=480 while preserving the
original destination, target, security options, receiver and returned object.
It requests focus once only if blur happens within 250 ms. No reopening,
focus loops, fabricated window handles or synthetic ad clicks are used.
Consecutive ad opens share one short-lived blur listener. Temporary iframe
references are weak so removed frames are not retained for a long viewing session.
Browsers ultimately control popup activation; this is not a universal focus
guarantee. In particular, noopener/noreferrer are never removed, and null is
not treated as proof of blocking when these options were supplied.

## Android safety contract

Only a trusted, active, neutral-content gesture can initiate handoff. UI
controls, links, playback and pending work cannot. Only empty-feature _blank
opens are eligible; explicit security features take the unchanged native path.
The allowlisted site modules capture search/filter/pagination and today/tomorrow
tab state directly. Arbitrary form values, passwords, file inputs, media
sessions, API tokens and DOM markup are not copied.

A 128-bit token and a 10-second sessionStorage checkpoint link the two tabs.
The publisher copy must restore all registered modules, scroll and appear
focused and visible before acknowledging. The original checks origin, exact
WindowProxy source, token, age, actual child focus/visibility and unchanged
parent state. Only then does it navigate to the original ad destination. Both
copies remove transfer state; the publisher copy restores the original hash,
and opener is detached before external navigation. Blocking, missing storage,
timeouts and failed restoration never navigate the original or retry an open.

## Reproducible checks

    node --test scripts/monetag-window.test.cjs scripts/ad-window-integration.test.cjs
    node scripts/ad-window-lab.cjs

The lab prints a localhost URL and serves only a publisher fixture, adapter,
temporary-frame network fixture and advertiser placeholder. It has no real ad
tags, analytics or playback API calls. Do not use repeated production ad
clicks as an automated test. A single actual-ad trial is optional and must be
performed by the operator as a real visitor, not traffic generation.

The Windows Chrome 155 lab verified an actual local popup, publisher focus and
visibility after 500 ms, unchanged search input and working protected controls.
VM tests cover unsupported browser gating and Android transfer success/failure;
these are not real Android, Safari/iPhone, Firefox, Edge or WebView device tests.

## Publication and rollback

Publish the two websites with their existing static workflows. KoraTV must
continue using build-complete-site.cjs so news and sitemaps cannot disappear.
No colors or styles are modified by this adapter.

The manual publish-player-ads.yml workflow uploads only allowlisted static
advertising-interface assets, including 739184.html, watch.html and the
view-support notice. It checks both current HTML hashes before changing anything,
backs up to /var/backups/koratv-player-ads/<run-id>, uses atomic file replacement,
and verifies playback file hashes remain unchanged. It never restarts services.
For rollback, run the same workflow with operation=rollback, the original
deployment run ID, and the currently verified public and embedded HTML SHA256
values. For websites,
revert the isolated ad-adapter commit and run their normal static publisher.

To stop adaptation in an already loaded page during diagnosis, call
PublisherAdWindow.dispose(). This restores methods without unloading ad tags.
Permanent browser rollout changes require editing the HTML flags and republishing.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- https://developer.mozilla.org/en-US/docs/Web/API/Window/opener
- https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
