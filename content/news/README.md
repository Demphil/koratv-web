# Internal News

The static publisher runs after match-page generation. It reads the previous
public news catalog before writing new output, preserving published URLs and
original publication dates. A catalog outage aborts publication instead of
deleting the archive.

Three fixed publisher feeds are fetched at build time, with conditional HTTP
requests and timeouts. Visitors read the local news snapshot, not third-party
RSS proxies. A failed client refresh leaves the initial HTML visible.

editorial.json contains source-attributed, manually reviewed original digests.
Add a source URL, source publication date, real review date, original title and
summary, image, tags, and at least two substantial original sections. Verify
facts and image provenance before committing. Do not copy full publisher text
or invent a byline. Publication dates are assigned on first publication.

Only reviewed digests receive NewsArticle markup and enter the article sitemap.
Short automatic source excerpts have internal detail pages but remain
noindex,follow. This avoids presenting thin syndicated snippets as original
reporting.

The article layout inherits the existing news stylesheet, background and color
variables. Playback, provider allocation, gateway services and DNS are outside
this publisher.

Run in this order:

    node --test scripts/news-pages.test.cjs
    node scripts/build-public-site.cjs
    node scripts/generate-match-pages.cjs --output _site
    node scripts/news-pages.cjs
