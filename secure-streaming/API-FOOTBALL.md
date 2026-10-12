# Player match details

API-Football enriches the match details displayed in the fabor.sbs player. Kooora
remains authoritative for the public schedule, match lifecycle and broadcasters.
The mobile application is not part of this integration.

## Identity and coverage

- Match requests use immutable numeric fixture, team, league and season IDs.
- English source names are attached using shared Kooora/Goal source team IDs.
  No Arabic query is sent to API-Football. Exact opponents, category and kickoff
  are verified; ambiguous matches are not joined.
- League/season coverage is checked before optional endpoint fallbacks.
- A paid subscription does not guarantee every league supplies lineups or player
  statistics. Unsupported and delayed data remain distinct states.
- Registered squads are never presented as official match lineups.

## Consumption policy

| Data | Refresh |
| --- | --- |
| Today's fixture schedule | 2 minutes while live/imminent; 30 minutes otherwise |
| Tomorrow's schedule | 12 hours |
| Live fixture details | 2 minutes, up to 20 fixture IDs per request |
| Pre-match details | 15 minutes within the final hour before kickoff |
| Dedicated lineup fallback | At most once per 15 minutes per fixture |
| Optional fallback endpoints | At most 3 calls per synchronization |
| Coverage by league/season | 24 hours |
| Standings | 24 hours, one league per synchronization |
| Knockout rounds | 4 hours, one competition per synchronization |
| Completed details | Stop once complete; incomplete snapshots retry after 15 minutes |
| English source identity reference | At most once per 30 minutes, only if needed |

Fixture batches already contain events, lineups, team statistics and player
statistics. Season-wide `/players` pagination is not needed for the player UI
and is deliberately not crawled.

Oracle uses `API_FOOTBALL_CACHE_DIR` for a persistent, private cache. Identical
in-flight queries share one request. An account-level file lock shares pacing
and budget across processes. Cache files contain no API credentials; obsolete
responses are removed after seven days. Failures never become cached empty data.

Production policy sets `API_FOOTBALL_DAILY_BUDGET=2000` for this website worker
and `API_FOOTBALL_QUOTA_RESERVE=100`. Both the local cap and provider remaining
quota are checked before each attempt, including retries. UTC midnight resets
the daily budget. These limits do not control other applications using the same
API account. Worker logs report request/cache counters without credentials.

GitHub's metadata job refreshes Kooora only; continuous API-Football polling is
owned by Oracle. Visitor requests read shared snapshots and never call the
upstream API. Site match lists omit heavy details; `/api/match-info` delivers
them to the player.

Reference: https://www.api-football.com/documentation-v3
