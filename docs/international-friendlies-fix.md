# International Friendlies - 2026-10-04

## Root Cause

Kooora's competition label is "المباريات الودية". The whitelist recognized
indefinite Arabic friendly labels and English labels but missed this definite
Arabic form. This excluded both Morocco-Mali and Argentina-Burkina Faso from
the shared frontend feed.

Direct Kooora data at the time of inspection identified:
- Morocco-Mali, 2026-10-04T18:00:00Z, FIXTURE.
- Morocco-Ghana, same kickoff, CANCELLED.
- Argentina-Burkina Faso, 2026-10-04T00:00:00Z, LIVE.

## Fix

- Recognize the actual Kooora international-friendly label.
- Retain the existing women's, youth, and club-friendly exclusions.
- Upsert unavailable Kooora/API fixtures with active=false so a previously
  scheduled row is retired on authoritative cancellation.
- Reject unavailable statuses in the public gateway even for legacy active rows.
- Do not spend API detail-refresh calls on inactive/cancelled fixtures.
- Keep valid finished fixtures visible until the existing Morocco day boundary.
- Keep both sites on the same gateway/Kooora-backed feed. No new frontend
  source or guessed broadcaster was introduced.

Tests: 45 metadata tests and 155 gateway tests passed.
Runtime commit: 40d5138. Deployment: Unified Data Refresh 37169549251.

## Production Verification

- Both koratv.click and fraja.online return Morocco-Mali and live
  Argentina-Burkina Faso from the shared public feed.
- Cancelled Morocco-Ghana is absent from both public feeds and mobile cards.
- Numeric match-info links resolve to the correct teams and match identities.
- Mobile browsing was checked at 390x844 on both sites.
- The Argentina player decoded 4 video frames during the browser check.
- Morocco-Mali is scheduled, with sourceReady=false at inspection time. Its
  future video playback was not claimed as verified.
- Repeatable point-in-time check: node scripts/audit-international-friendlies.cjs.

Source: https://www.kooora.com/كرة-القدم/مباريات-اليوم
