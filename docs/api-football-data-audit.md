# API-Football Data Audit - 2026-10-03

## Confirmed Findings

Read-only production comparison: GitHub Actions run 37157011513.

- Raja Casablanca vs CR Khemis Zemamra: API fixture 1640792 already had 14
  events and two empty statistics groups in Supabase. Kooora's Raja name was absent
  from the bilingual identity map, preventing attachment to its player page.
- CODM Meknes and Difaa El Jadida had the same identity-mapping gap.
- Detail enrichment stopped at the first 20 rows. It treated a successful HTTP
  response with empty detail arrays as complete and stopped revisiting ended
  fixtures even when their lineups were missing.
- The API request helper had no timeout, request pacing, or bounded transient
  retry policy. Channel reconciliation was an unnecessary prerequisite for
  attaching independently verified sports details.
- Coverage for Botola Pro 2026 advertises events, lineups, and team statistics,
  but not player statistics. Several individual fixture responses still had
  empty lineups. Season-level coverage is not a per-fixture availability promise.
- A second direct audit (37157841850) fetched Raja fixture 1640792 explicitly:
  15 events, empty batched lineups, and empty `/fixtures/lineups` response. This
  missing lineup was confirmed upstream, not inferred from the player UI.

## Implemented Contract

- Keep Kooora schedule, source identity, broadcasters, score, and lifecycle.
- Join API data using exact opponents and kickoff, then verified API team IDs.
  Reject conflicting source fixtures and ambiguous candidates; never infer a
  lineup, player rating, or opponent from a fuzzy name match.
- Retrieve up to 100 due fixtures per cycle in batches of at most 20, oldest
  snapshots first within live priority. Additional rows remain eligible for
  subsequent cycles rather than being permanently ignored.
- Check league/season coverage in the background with reusable four-hour
  snapshots and a bounded six-league discovery budget per cycle.
- Preserve usable prior arrays when an empty response arrives. Record feature
  states separately: available, stale, pending, or not_covered.
- Retry incomplete ended fixtures for up to 24 hours after kickoff. A fetched
  fixture is not automatically a complete fixture.
- For supported missing lineups/statistics, try their dedicated fixture endpoint
  with at most three fallback calls per cycle and a 15-minute feature cooldown.
- Serialize provider requests, space them at least 250 ms apart, use a 15-second
  timeout, retry transient errors at most twice, and stop at exhausted daily quota.
- Materialize attached sports details in the shared Supabase snapshots for both
  frontends. No visitor performs a paid provider request.
- Preserve the site's existing competition visibility policy. That policy does
  not remove a valid API source needed by an already selected Kooora fixture.

## Sources

- https://www.api-football.com/documentation-v3
- https://www.api-football.com/coverage
- https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage

Tests cover name/ID orientation, delayed and unsupported coverage, 25-fixture
batching, finished partial retries, non-destructive empty refreshes, exact-ID
fallbacks, transient provider failures, quota exhaustion, and serialized requests.
Availability for every world league or fixture cannot be promised by our code.

## Production Verification

- Runtime commit `a87067d` deployed successfully through Unified Data Refresh
  run `37157839696`, including the Oracle metadata worker and fabor player.
- Local suites passed: 44 secure-streaming tests and 153 gateway tests (197
  total); player build and workflow YAML validation passed.
- `node scripts/audit-match-details.cjs` verified both allowed frontend origins
  against their shared gateway. Hassania, CODM, Difaa, and Raja returned their
  exact API fixture IDs and 13, 17, 19, and 15 events respectively.
- Raja player rendered all 15 events at 1366px and 390px widths without
  horizontal overflow. Its lineup tab correctly reported missing provider data.
- The two statistics groups for Raja contain no actual statistics. They are
  pending, not proof of populated statistics. No lineup or statistic was invented.
- This verifies metadata retrieval and rendering for these fixtures, not stream
  playback, all global leagues, or future provider availability.
