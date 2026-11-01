# KoraTV SEO and external app placement

Scope: koratv.click only. Preserve background, colors, match/player behavior,
provider reservations and backend credentials. Fraja and KoraScoreAi source were
read for context only; neither frontend was modified in this task.

## Observed Reference

The owner-selected open Chrome tab was https://koraylive.live/. Browser DOM and
metadata inspection confirmed a branded title/heading, canonical URL, descriptive
snippet metadata, crawlable match/news links, WebSite/Organization/BreadcrumbList
markup and an app advertisement above the match list linking to Google Play.

The reference also repeats Organization and WebSite definitions with inconsistent
names, declares many other domains as sameAs and advertises broad performance
claims. Those are observations, not evidence that such tactics cause rankings.
They were not copied. Competitor copy/artwork and private data were not reused.

The Google result in the owner's screenshot is an organic search result, not
proof of a paid search placement. The owner clarified the requested advertisement
is an independent-looking KoraScoreAi placement within KoraTV.

## Applied Changes

- Keep koratv as the primary site name, adding its Arabic brand spelling to real
  title, visible H1 and WebSite/Organization alternateName values consistently.
- Describe actual results, statistics and live events. Do not claim video rights,
  4K coverage, guaranteed availability or a homepage radar that is not present.
- Keep self canonicals, one identity graph, Open Graph/Twitter metadata and existing
  internal result/news archives. Allow full text snippets without keyword stuffing.
- Preserve original asset versions and ad copy when the SEO maintenance tool runs.
- Add a static, disclosed external KoraScoreAi placement above the home schedule,
  with existing site colors, the app's own bitmap logo and an official Play link.
- The app store page was visibly verified in Chrome: KoraScoreAi: Football Scores,
  developer Frajatv Team, package com.korascoreai.app. Copy stays within real store
  features and does not promise ad-free service, certainty or guaranteed forecasts.
- Label the placement as an advertisement, without claiming Google or an ad network
  supplied it. Exclude it from snippets with data-nosnippet; protect its normal
  external navigation from the site's popunder adapter with data-no-popunder.
- Real app-link navigation records app_store_open in the existing Analytics
  property. Only constant app/placement labels are sent, not referrers or tokens.
  Store navigation is not an installation or conversion guarantee.

## Build Feed Correction

The first full build exposed a 403 on the new public metadata JSON. The ingest
service's private umask reduced the atomic replacement file to 0600. Fixed the
public allowlist writer to explicitly chmod its directory/file to 0755/0644 before
rename, and tested two replacements under umask 0077 on Linux. Private snapshots,
database exports, JWT files and credentials retain their private permissions.
No NGINX, video or application restart is needed for this correction.

## Verification And Publication

The final complete frontend unit/regression suite passed 83/83 tests, including
app-navigation analytics. The Linux permissions regression passed separately.
A full build
retained 703 match pages, 1136 match archive URLs, 490 internal news pages and the
reviewed article sitemap. Archive output was validated before publication.
Desktop and 390px responsive screenshots confirm a readable promotion and the
original background. Viewport emulation is not a physical-phone test.

GitHub check annotation for the latest inspected publishing attempt explicitly
states the job did not start because the account is locked due to a billing issue.
This is separate from code validation. No payment, subscription change, DNS move
or repository transfer is authorized/performed in this task. Do not report a local
build, pushed source or failed publishing job as a live website release or indexing.

## Primary References

- https://developers.google.com/search/docs/appearance/title-link
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/snippet
- https://developers.google.com/search/docs/appearance/structured-data/sd-policies

These changes can improve clarity and crawlability. Google can rewrite titles
and snippets; neither technical parity nor structured data guarantees indexing,
rich results or the competitor's ranking.
