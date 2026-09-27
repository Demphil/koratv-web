# Public Match Embeds

The embed button opens a native modal dialog in the browser top layer, including
while the player is fullscreen. Copy the generated iframe for the current match.
Its URL uses `/watch.html?match=<match-id>`, never the original viewer's IP-bound,
short-lived entry ticket. Each embedded visitor gets a separately authorized
session for that exact match. Reloads retain that match identity.

HTTP(S) sites and local HTML files opened with `file://` may embed the player.
Public player documents and their nested sandboxed ad frames intentionally omit
`frame-ancestors` and `X-Frame-Options`: an HTTP(S)-only ancestor allowlist blocks
local files with opaque origins before the player can even load. Do not add
these headers back on the public player host or its reverse proxy.
API CORS, token origin checks, rate limits,
IP/session validation and account capacity restrictions remain unchanged.

Embedding terms: preserve the complete player, branding and controlled ads.
Do not crop it, cover it, remove its elements or modify its contents. The
cross-origin browser boundary prevents a normal embedding site from editing
the player DOM or accessing its session storage. The player keeps the existing
internal integrity checks and protects its branding container.

Technical limits: a child frame cannot reliably inspect a cross-origin parent's
layout, detect all CSS cropping/covering, prevent ad blockers, or force a parent
to grant popup/fullscreen permissions. These conditions cannot be guaranteed by
client JavaScript. Reports of abusive embedding require operator review and
revoking access or switching to an approved-origin policy if necessary.
