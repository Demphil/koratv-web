# Kora Fabor Gold And White Theme

Scope: the public korafabor.pro frontend on Njalla only. No Oracle service,
provider reservation, media route, Fraja palette, or player advertisement changed.

The domain profile injects `korafabor-theme.css?v=20261102-gold2` after the original
styles and mobile viewport repair. The isolated theme uses the logo's #e4c67e gold,
#f5f7f4 white and neutral graphite surfaces. Existing team/news images, semantic
red/yellow cards, live badges and the KoraScoreAi ad's emerald/coral identity remain.

The header no longer wraps navigation labels on desktop. At the owner's request,
featured match cards retain their original full-width vertical order on desktop
and phones, with natural card heights. Sections are unframed, individual
match/news items keep restrained borders, and controls use gold with dark text.
News, internal articles, results archives and the footer share the same palette.
The 100lvh mobile background layer remains active and inherits the new backdrop.

Focused tests verify one theme link after repeated migration, untouched Google
verification, status/ad boundaries, and text/control contrast on all three actual
surface colors. The frontend suite has 96 passing tests. Responsive checks cover
390-pixel phone layouts and desktop, including the article page and no horizontal
overflow. Emulation is not a physical Android or iPhone compatibility test.

`update-korafabor-theme.mjs` runs under the existing unprivileged publisher and lock,
copies the current release, changes head/root theme metadata only, verifies body
markup and protected asset hashes, then promotes an atomic release pointer. It
updates the work-tree stylesheet and migration for future timer builds. The
previous release remains available for rollback; no streaming restart is needed.
