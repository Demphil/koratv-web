# Isolated player deployment

The supported deployment is now the dependency-free Cloudflare Worker in `cloudflare/worker.js`. See `cloudflare/README.md` for dashboard-only setup. The VPS/Express instructions below are retained for reference and are no longer the chosen architecture.

This is a separate, opt-in implementation. It does not replace the running watch routes or deploy changes to production automatically.

## 1. VPS API

Use Node 22+, Redis, and an HTTPS reverse proxy for `stream-api.koratv.click`.

`nginx.conf.example` includes both HTTPS virtual hosts and player security headers. Configure DNS, certificate paths and the player document root before enabling it.

```sh
npm ci
cp .env.example .env
# Configure a random secret, Redis, approved HLS origins and channel URLs in .env.
npm test
npm start
```

Run `node scripts/setup-env.js` to prepare ignored gateway and frontend `.env` files with independent random JWT/HMAC secrets. The example file deliberately contains placeholders: committed secrets are not private. Existing configured values are preserved. Next.js `.env.local` takes precedence over `.env`; remove conflicting public values there if necessary.

Apply `supabase/live_matches.sql` in Supabase, then add rows with the match ID, exact `STREAMS_JSON` key as `channel_id`, and `is_streaming_active`. The backend queries the real row on token issuance, redemption and media requests. The frontend checks the same row with the public key. Missing rows, RLS denial and database failures disable playback. No mock configuration remains. The optional `SUPABASE_SECRET_KEY` belongs only in the gateway environment; the supplied column grants allow public-key reads without it.

`JWT_SECRET` signs tokens and derives the resource encryption key. Independent `HMAC_SECRET` hashes client IPs. Rotating either invalidates existing sessions. Supabase JWKS is not needed for these gateway-issued JWTs.

Cloudflare header priority is enabled only for immediate peers in `CLOUDFLARE_HEADER_TRUSTED_PROXIES`. For Nginx on loopback, set that value to `loopback` only after locking its inbound traffic to Cloudflare and sanitizing headers. Express retains explicit `TRUSTED_PROXIES` rather than trusting arbitrary forwarding headers with `true`. The direct-facing Nginx example should strip incoming CF headers with `proxy_set_header CF-Connecting-IP "";` until Cloudflare ingress is configured.

Only server-configured HTTPS HLS sources are accepted. Redirecting sources must be configured with their final URL. Include every playlist, segment and key origin in `UPSTREAM_ORIGINS`. Source DNS and these allowlists must be administrator-controlled. No transcoding occurs. MPEG-TS-only sources must first be packaged as HLS.

Bind Express to loopback and block direct external access to port 3100. For a directly internet-facing Nginx instance use `proxy_set_header X-Forwarded-For $remote_addr`, not a client-supplied forwarding chain. If Cloudflare or another proxy fronts Nginx, configure Nginx real-IP handling for the exact trusted proxy ranges first. Set Express `TRUSTED_PROXIES` to the actual immediate proxy addresses. Both token and media requests must reach the same API hostname and resolve the same client IP. IP changes invalidate the session.

Origin/CORS checks restrict ordinary browsers, but are not authentication: non-browser clients can forge Origin and User-Agent. Add your existing account/entitlement validation to `/api/generate-token` if playback is restricted to authorized subscribers. Redis is required for atomic single-use redemption across PM2 workers. All workers must share the same secret and Redis instance.

## 2. Player host

```sh
npm run build:player
```

Deploy `dist/player.html`, `player.js`, `player.css`, `config.js`, and `hls.min.js` to `https://medic.cymru`. Apply the HTTP headers in `dist/headers.txt` through the host configuration; that text file is a deployment checklist, not an automatically applied configuration. `frame-ancestors` must be an HTTP response header. Configure `PUBLIC_API_ORIGIN` in the build environment if the API hostname differs.

The player requires MediaSource support. hls.js attaches a blob media URL; native-HLS-only browsers get an explicit unsupported message instead of a direct URL fallback. Blob URLs, disabled right-click and key shortcuts do not hide requests from network inspection or provide DRM. No implementation can guarantee invisibility from DMCA crawlers using User-Agent matching.

The entry ticket is removed from the address bar immediately and redeemed once. Redact token query strings from API, CDN and player access logs. Entry tickets expire in 300 seconds; the redeemed session lasts 300 seconds. Playback stops at expiry and requires another click on Watch Match. Every manifest, segment and encryption-key request validates the session and IP. No automatic extension bypasses the requested TTL.

## 3. Next.js frontend

Set `NEXT_PUBLIC_STREAM_GATEWAY_ORIGIN=https://stream-api.koratv.click` in the Next.js build environment. Import `src/components/isolated-player/MatchCard.jsx` in a server-rendered match page:

```jsx
import MatchCard from '@/components/isolated-player/MatchCard';

<MatchCard match={{
  homeTeam: 'Home', awayTeam: 'Away', homeScore: 1, awayScore: 0,
  id: 'your-match-id', status: 'LIVE', channelId: 'demo'
}} />
```

Pass your live match data as props and refresh it using the existing score-fetching flow. The component does not create another score scraper. Keep the page dynamic/private: it reads request headers and fetches the flag with `cache: 'no-store'`; do not cache bot-specific HTML at the CDN. Allow the API in frontend CSP `connect-src` and `https://medic.cymru` in `frame-src` if your frontend sets those directives.

The component hides Watch Match for recognized crawler User-Agents and disabled flags. This is a presentation rule, not a security boundary. The API enforces the active flag independently. The current static homepage must be migrated to a Next.js page before it can render this server component.

## Verification

`npm test` checks origin rejection, ticket replay, IP mismatch, expiry, malformed tokens, manifest/key/segment rewriting and the kill switch. These are local HTTP integration tests with a mocked upstream and Redis interface. Test a real licensed HLS source on the deployed HTTPS domains, including its codecs, Redis, proxy IP configuration and browser playback, before switching production traffic.
