# Broadcast Operator Console

The private console is served by the shared Oracle gateway. Its address is stored
only in the owner's private credential file and the deployment secret
`BROADCAST_ADMIN_CONSOLE_PATH`, not hardcoded in source or public assets.

Both public frontends and the Njalla player use the same control state. There is
no separate copy to edit on each site. Existing protection, embed paths, supplier
credentials, and advertisement tags are unchanged.

## Access

Run `node scripts/provision-operator.mjs` from `streaming-gateway` once to create a
random password. The script stores only its scrypt hash in the GitHub repository
secret `BROADCAST_ADMIN_PASSWORD_HASH`. Login credentials are written outside the
repository, in the current user's `.codex/private-access` directory. Never commit
or upload that credential file. Deploy with the existing Unified Data Refresh.

Authentication uses a two-hour Redis session in a Secure, HttpOnly, SameSite=Strict
cookie, same-origin writes, CSRF tokens, and a login attempt limit. The console
cannot be framed. Passwords, supplier URLs and account credentials are not sent to
the browser. These controls follow the OWASP session and CSRF guidance:

- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Controls

- Select and order up to eight preferred fixtures. Unfilled slots continue using
  the automatic priority system. Disable manual preference to return to automatic
  selection. Future fixtures do not consume a resource before the preparation window.
- Enter a channel or choose from the current catalog. The gateway discovers it
  through free supplier accounts and probes a playlist plus a media segment before
  saving the correction. If no free account exists, the current channel is kept.
  A media probe verifies transport availability, not the identity of the match on
  screen. The operator must still visually confirm the supplier's programme.
- Publish up to ten text/image notices, choose the number of queue cycles, display
  duration, gap, and all players versus selected fixtures. Stop removes the notice
  immediately from connected players, including embeds. Images are compressed in
  the browser (up to 960px on each side, under 180 KiB) and validated server-side;
  SVG and HTML are not accepted. Notices use the same transparent depth styling
  in the dashboard preview and player, travel across the player, and leave video
  controls clear. Images are not cropped and can be expanded by the viewer.
  Reduced-motion preferences disable traversal.

Each ad now has a title and caption with independent colors, font sizes, weights,
alignment, animation type, and animation cycle duration. The title can appear
above or below the caption. Image side/size, ad width, vertical placement, and
background color/opacity are per-ad settings; the default surface is completely
transparent. Per-ad traversal duration is 5-120 seconds, falling back to the
campaign duration. The queue gap can be zero. The shared renderer uses a two-point
linear Web Animations API traversal from beyond the right edge to beyond the left
edge, with no center hold; its geometry is recalculated on player resize.
See https://developer.mozilla.org/en-US/docs/Web/API/Element/animate .

Public frontend and player builds reject the private console route if it is
accidentally included in a visitor asset. The route is configured only in the
private server environment; secrecy does not replace login, CSRF protection, or
session controls. The console is not registered without the private path setting.

Changes are persisted under `/etc/koratv/operator-control.json` (0600). Uploaded
images are under `/etc/koratv/operator-media`. Deployments do not replace those
files. Operator channel corrections also participate in the four-hour catalog
renewal and take precedence over repository corrections until expiry.

Resource/route writes use the existing flock locks. Operations are serialized,
and failed resource application attempts restore the prior selection/correction.
The dashboard records an operation's phases and failure rather than claiming a
failed stream is ready. Clients receive SSE updates with reconnect support and a
bounded polling fallback in the player. Offline clients cannot update instantly;
they receive the latest state when connectivity returns.

## Verification

`npm test` in `streaming-gateway` includes authentication, CSRF, queue validation,
failed channel preparation, persistence precedence, and live publish/stop tests.

`node scripts/audit-operator-console.cjs` from the repository root runs a local
fixture-only browser check for desktop/mobile layout, notice images, embedded
delivery, immediate stop, and session-refresh messages. It never changes live
fixtures or posts notices to real viewers.
