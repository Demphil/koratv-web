# Shared player match data: economy profile

## Scope

The fabor.sbs player keeps its existing video delivery and banner controls. A separate
short-lived systemd task publishes `/site-metadata/match-details.json`; Nginx serves
that static JSON. A visitor cannot cause an API-Football request by opening or
refreshing a page. There is no additional always-running Node server or browser.

Only IDs in `shared/broadcast-selection.mjs` are enriched, with a maximum of 20.
The current selection contains four matches. The Kooora schedule remains the source
of the website schedule and the immediate fallback for names, logos and results.

## Request budget

### Active Shared-Key Policy

The saved API-Football key was found in `D:/Frajatv/supabase/.env`. The verified
Oracle recovery archive is present under `D:/KoraScoreAi-Recovery-20261103/Latest-verified`;
its encrypted original and DPAPI file were not modified or fully restored.

The application has central Forecast reservations, so the saved provider key is
NOT copied to AWS or used through an independent local quota counter. AWS uses
only the application's existing public `sports` resource `liveFixtures`, a read-only
cache path. This mode cannot call provider endpoints, bypass the shared authority
or spend additional API-Football requests. The direct key is empty in AWS settings.

Cache discovery is reused for ten minutes. Missing detail fields may appear when
the application collector fills its own cache; this integration does not force a
refresh. Incomplete final records can be reread at most every thirty minutes within
the application's six-hour live/final cache window. Recently selected contexts are
retained for 48 hours across midnight schedule rotation, with their original
schedule timestamp preserved. Unknown fields are not fabricated.

The public player can read a sanitized GitHub snapshot, including while its
custom-domain certificate is pending. Its public-repository workflow runs every
ten minutes; unchanged data is not committed more than once per six hours. No
application keys, customer data, private API key or admin credentials enter it.
Workflow scheduling and CDN freshness are not real-time guarantees.

### Inactive Dedicated-Key Profile

The following limits remain available only for a separately authorized dedicated
website key. They are NOT the active policy for the application's shared key.

| Operation | Policy |
| --- | --- |
| Fixture discovery | One date query, cached for six hours and reused across selected fixtures |
| Before kickoff | One detailed warmup in the last 30 minutes |
| During play | One bundled `/fixtures?id=...` request per match every ten minutes |
| After completion | Final detailed response retained; no continued live polling |
| Visitor refresh | Static JSON only; no upstream API request |
| Local daily maximum | 60 counted attempts, including failed calls, persisted across restarts |
| Provider quota reserve | Stop when the reported remaining daily quota is 20 or lower |
| Pacing | At least 6.5 seconds between calls; no automatic retry burst |
| API failures | Fifteen-minute backoff; preserve prior data and continue the video |
| Stale schedule | No API spend when the schedule is more than 30 minutes old |

For four two-hour matches, one pre-match request, twelve in-play requests and one
final request each are approximately 56 detail requests, plus shared date discovery.
This is an estimate, not a promise of a complete update cadence: provider delays,
extra time or quota used by another application can cause the hard cap/reserve to
stop updates sooner. Increasing `PLAYER_API_DAILY_BUDGET` above 60 cannot bypass
the code cap. The counter resets on the provider's UTC day.

The reserve is based on API response headers. If another application shares this
key, its activity is reflected when the next response arrives; this component
cannot guarantee an account-wide reserve against independent concurrent consumers.
Prefer a dedicated website key/account or an existing central quota authority.
Never bypass another application's quota reservation or expose its key publicly.

## Identity and UI

Details are joined only when both teams, kickoff and match category agree. Ambiguous
or missing matches are not guessed. In particular, Paris FC is not PSG. Reversed
provider orientation is corrected for scores, logos, statistics and events.

The existing detail and lineup tabs are reused. Source and update time are shown;
missing statistics remain missing, not zero. Cached data is identified as cached.
The metadata renderer does not call video play/pause/load, change its source,
trigger ads or recreate the player. Background-tab polling stops and page exit
aborts pending work.

## Provider and infrastructure limits

- Official pricing lists 100 requests/day for Free, with restrictions on available
  seasons: https://www.api-football.com/pricing
- Fixture-by-ID can include events, lineups and statistics without four separate
  endpoint calls, subject to data coverage and plan availability:
  https://www.api-football.com/news/post/how-to-get-all-data-from-a-league-with-api-football
- Shared backend caching is recommended by the provider:
  https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage
- No subscription upgrade, extra instance, database or paid cache is provisioned.
  This policy covers match-data calls, not AWS video egress. Video traffic still
  consumes AWS transfer/credits under the existing HLS architecture.

## Activation status

The shared app-cache mode matched all four selected fixtures and supplied their
real API-Football IDs, logos, referee and venue. Venezia-Bologna also supplied
statistics, events and lineups; the other three did not have those fields in the
read-only cache at verification. No upstream refresh was forced to fill the gaps.
Public desktop/mobile readback showed `API-Football` and the application-cache
label, with no video calls or page errors in the metadata-only QA browser.

The original saved Supabase URL no longer resolves, so an attempted read-only
account-counter comparison could not complete. No quota mutation or provider
request was made by that failed diagnostic. Zero additional provider requests is
enforced by the active adapter's fixed cache-only endpoint and lack of a provider
key on AWS, not a claim that other application activity leaves its global counter
unchanged.
