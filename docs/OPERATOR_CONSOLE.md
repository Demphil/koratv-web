# Broadcast Operator Console

The private console is served by the shared Oracle gateway at:

`https://stream-api.koratv.click/api/operator/console`

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
  the browser and validated server-side; SVG and HTML are not accepted.

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
