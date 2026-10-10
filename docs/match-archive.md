# Public results archive

The existing match-page generator now retains previously published results. It
loads `/archive/catalog.json` before building; monthly content-addressed JSON
shards contain only public result-page HTML and display metadata, never database
payloads or provider credentials. A failed fetch, checksum mismatch or malformed
catalog aborts publication. The first build imports still-accessible match pages
from the current public sitemap. Already missing pages cannot be reconstructed
without an authoritative snapshot and are not replaced with invented results.

The archive is independent of the daily frontend cache and its Africa/Casablanca
midnight rollover. Results are snapshots, not a claim of continuous live updates.
Completed scores remain on their existing URLs after disappearance from the feed.
Fixture identities are hashed to preserve URLs when display names change.

Each publication regenerates month, competition and team directories with HTML
links. One-fixture competition/team directories remain usable but are noindex and
excluded from the sitemap until more data arrives. Match `lastmod` is retained
when HTML is unchanged; database refresh timestamps alone do not imply updates.

All Pages publishing workflows share a concurrency group to prevent overlapping
read/merge/deploy cycles. The published catalog and its referenced shards must be
included in any future hosting migration or restore. GitHub Pages deployment
artifacts additionally contain this state, but are not a permanent backup.

Validation: `node --test scripts/match-archive.test.cjs
scripts/generate-match-pages.test.cjs scripts/prerender-match-list.test.cjs`.
Desktop/mobile no-JavaScript QA: `node scripts/audit-match-archive.cjs` from the
KoraTV checkout; add `--live` after both sites deploy. The audit checks both builds.

Google indexing requests are optional discovery hints, not indexing/ranking
guarantees. The Google Indexing API is not used for ordinary results pages.
