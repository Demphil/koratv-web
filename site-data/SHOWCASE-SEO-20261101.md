# Kora Fabor Frontend, Advertising And Search Verification

Scope: the new public Njalla frontend only. Oracle, Fraja, player advertisements,
provider bindings, wallets, reports and private administration were not changed.

## Approved Media

The owner rejected the earlier analyst screenshot and selected
`D:/Frajatv/docs/social-reels-20261028/publication.html` instead. Six Arabic feature
frames were extracted from that publication's genuine 1080 x 1920 tour at seconds
6, 12, 18, 24, 30 and 36. The source video and original app values are unchanged.
The frames demonstrate Forecast, live scores/statistics, illustrative Radar,
Insights, report explanations and the saved-report Vault. They are dated examples,
not a current match, new model execution, guarantee or measured tracking.

The display uses a locally bundled Three.js 0.187.0 scene with six screens on
desktop and a sequential carousel on phones. It supports previous/next, pause,
swipe and full-resolution expansion. No video, model request or sports API request
is used. Rendering is capped at 24 fps, DPR 1.5 and 2.4 million pixels, and pauses
when hidden/offscreen. Reduced-motion and non-WebGL fallbacks retain usable HTML.
The original frames are Full HD portrait; a 4K viewport test does not make them
native 4K photographs. Lucide icons and dependency licenses are shipped locally.

Build tools are isolated under `tools/showcase`, not installed on the web host:

```sh
npm ci --prefix tools/showcase --ignore-scripts --no-audit --fund=false
node scripts/build-showcase.cjs
node --test scripts/*.test.cjs
```

`scripts/build-public-brand.cjs` generates the new logo aliases, favicon and
1200 x 630 social image using Sharp. The header's scalable extruded wordmark uses
the site's gold/ivory identity, separate from the app's emerald/coral identity.

## Advertisements

The new domain is verified in Monetag, site ID 3558838. Its owner-supplied tags:

- Popunder: 12170985, `https://al5sm.com/tag.min.js`.
- Vignette: 12170997, `https://n6wxm.com/vignette.min.js`.
- Supplied verification worker: zone 12170885, `https://5gvci.com`.

Old frontend zones 11820367/11820368 and the separate quge5 tag were retired from
the new site's artifact. The existing narrow window adapter loads before the
Popunder tag, preserves security features/real return references, and requests
one focus restoration within a temporary 250 ms blur window on its existing
Windows Chrome rollout. Important controls, playback and state-transfer guards
are retained. No new synthetic clicks, impressions, reopens or focus loops exist.

Vignette is an inline overlay, not a popup, and cannot be made a background window
by this adapter. Android tab-role swapping remains disabled until a real Android
Chrome test, as the owner's earlier compatibility requirement explicitly rejects
emulation as proof. No universal foreground guarantee or revenue guarantee exists.
The shared player keeps its separate existing ad profile and does not tab-swap.

## Search Ownership And Sitemaps

The supplied Google HTML and Bing XML are public verification files. The builder
copies them and keeps the Google file byte-identical. It also preserves the exact
supplied root worker instead of minifying it. This fixes the scheduled build that
previously dropped Bing XML and wrapped Google's plain verification content.

Google ownership was verified. Google Search Console subsequently read both maps:
`sitemap.xml`: Success, 1142 discovered pages; `sitemap-articles.xml`: Success,
4 discovered pages. Bing read both maps with Success: about 1.1K discovered URLs
in the main map and 4 in the article map. Both properties remain open as evidence.
Submission/read success is not indexing, rankings or traffic.

Canonical URLs, structured publisher identity, share images, footer and header
are rewritten to Kora Fabor. Old social URLs containing the retired domain handle
are removed, without inventing replacement accounts. Useful archived results and
source attribution are retained. Retired duplicate aliases use path-specific 301
redirects on the new domain. Unknown routes remain real 404s.

The legacy source-profile origin is retained only in the isolated archive-building
pipeline to validate existing durable archive state; it is not a public canonical.
Do not globally replace `stream-api.koratv.click` or playback URLs. They remain
operational dependencies, not stale marketing links. The old domain's external
DNS/301 handoff still requires restored Namecheap access.

## Final Verification

- Public release: 1793566900788, followed by bounded public-asset/legacy cleanup.
- 2049 HTML files including two Google verification documents; 2047 regular HTML
  pages scanned and 1142 indexable pages, with no retired ad tags or old public
  publisher identity/canonical findings. The old Pinterest verification page was
  removed from the new artifact and excluded from future publications.
- Frontend regression tests: 91 passed.
- Live SEO sample: 20 pages, 0 errors, 25 advisory title/description-length warnings.
- The live browser loaded all six frames, WebGL and 20 eligible match cards. The
  canvas screenshot had substantial pixel variation, not a blank rendering.
- Responsive testing included a large/4K viewport and a 390 CSS-pixel viewport;
  manual next/pause/expand controls worked. This is not a physical Android test.
- HTTP checks: verification documents remain byte-identical; sitemaps/robots are
  200; retired duplicate aliases are 301; unknown URLs/rejected preview are 404.
