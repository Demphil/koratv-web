# KoraFabor live-streaming search intent

Reviewed on 2026-11-27 (Africa/Casablanca). Scope: KoraFabor only; no player,
provider, advertising, infrastructure or other website identity changes.

## Search sample, not a universal ranking

Arabic searches around live football and today's matches surfaced these examples:

- https://www.yallashoooootlive.com/ uses a brand plus today's live matches in its title,
  with yesterday/today/tomorrow schedule navigation.
- https://kooralivesports.com/ appeared in two sampled query groups with today's live
  matches in its title. Direct access returned 403, so comparison used the indexed excerpt.
- https://topmatch.online/ar uses today's live matches in its primary heading and
  watch links for available matches.

These results do not establish a global number-one website, search volume, traffic,
keyword difficulty or rank in every location. Competitor names and unsupported
claims about quality, uninterrupted playback or complete coverage are not reused.

## Keyword and page map

| Page intent | Primary phrase | Supporting phrases |
| --- | --- | --- |
| Home | بث مباشر مباريات اليوم | مشاهدة مباريات اليوم، كورة فابور بث مباشر، جدول مباريات اليوم |
| Selected live match | بث مباشر مباراة [الفريقين] | مشاهدة المباراة، النتيجة الحالية، القنوات الناقلة |
| Selected upcoming match | موعد بث مباراة [الفريقين] والقنوات الناقلة | توقيت المغرب، موعد المباراة |
| Finished match/archive | نتيجة مباراة [الفريقين] | أحداث المباراة، الإحصاءات |
| News | Original article topic | Teams and competition actually discussed |

Home title: **بث مباشر مباريات اليوم | كورة فابور KoraFabor**

Home description: **شاهد البث المباشر للمباريات المختارة على كورة فابور KoraFabor،
وتابع جدول مباريات اليوم والقنوات الناقلة والمواعيد والنتائج بتوقيت المغرب.**

The homepage H1, schedule heading, navigation, title, description, social metadata
and WebPage/WebSite descriptions now agree. Only today's explicitly selected live
fixtures receive a live heading and the existing fabor.sbs player link. Unselected,
finished, historical and news pages retain their own intent. Canonical URLs, sitemaps,
logos, yellow theme, footer, verification files and app promotion are preserved.

## Search-engine boundaries

- Google ignores the keywords meta tag; it is removed from the KoraFabor output.
  https://developers.google.com/search/docs/crawling-indexing/special-tags?hl=ar
- Titles should accurately describe the page. Google can choose a different title
  and must recrawl/reprocess a changed page, which may take days to weeks.
  https://developers.google.com/search/docs/appearance/title-link?hl=ar
- Descriptions are page-specific and readable rather than keyword lists. Google
  may select text from the page for the snippet instead.
  https://developers.google.com/search/docs/appearance/snippet?hl=ar
- No VideoObject or BroadcastEvent markup is added: these changes do not establish
  hosted-video eligibility, broadcast rights or rich-result eligibility.
- Deployment verification is separate from indexing and ranking. No ranking,
  indexing, traffic or click-through improvement is claimed from these edits alone.

## Verification

Publication uses the existing complete-site builder and KoraFabor migration, not a
homepage-only upload. Automated checks cover metadata consistency, canonical URLs,
scope, archived results, selected-live links, news preservation and repeatability.
Live deployment status is recorded only after the GitHub Pages run and HTTPS
readback have succeeded.
