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

The current AWS and KoraTV configuration files did not contain an API-Football key.
The deployed task therefore publishes truthful Kooora fallback data and spends zero
API-Football requests. The user was asked for the location of the private settings
file, not its contents. Full provider activation and real API detail verification
remain gated on the correct key and plan/season coverage. No key is committed.
