# Match content verification

The gateway starts checks at the shared 35-minute opening boundary. Transport readiness
and content identity are separate signals. A working URL is never content proof.

The local RapidOCR/ONNX engine reads two decoded frames from the HLS bytes already
fetched under the gateway lease. No provider credentials, video frames, or inference
requests are sent to a vision API. FFmpeg and OCR are bounded; inference is serialized
and cached by match identity, provider, and exact source for 90 seconds.

Two consistent scoreboards showing both teams are required for `verified`. Unreadable
frames, studio coverage, missing aliases, and jumping highlight clocks remain `pending`.
Before kickoff, a different ongoing programme is pending rather than a false failure.
This cannot guarantee identity before the broadcaster actually shows the fixture.

Automatic discovery rotates the listed fixture broadcasters and idle providers A-J.
It samples at most eight candidate sources per attempt, skips accounts reserved for
other fixtures, and waits five minutes between attempts for a match. Unknown or wrong
content is never installed as a confirmed alternative. Candidate probes atomically
refuse occupied accounts. Existing watched leases are only read through their cache;
they are not borrowed to test different channels.

A confirmed alternative is committed through the operator mutation queue, with a fresh
state revision and another idle-provider check. Only the target match receives a control
revision. Unrelated leases are preserved and the old target binding is restored if the
transfer fails. When no free account exists, the panel explicitly reports that it waits.

## Runtime

Install Python packages in a dedicated virtualenv using `content-ocr-requirements.txt`.
FFmpeg is required; Tesseract with English/Arabic data is a conservative local fallback.
Set `STREAM_CONTENT_VERIFICATION_ENABLED=true` only after checking the OCR runtime.
The feature defaults off for safe rollout. `STREAM_CONTENT_OCR_PYTHON` can override the
dedicated `/opt/koratv/content-ocr-venv/bin/python` executable.

Stage the tested release with a SHA-256 manifest named `content-release.json`.
Run `scripts/activate-content-verification.mjs RELEASE` for a dry-run. The explicit
`--activate-when-idle` mode checks viewer counts over a quiet minute, backs up files
and configuration, checks again immediately before restart, and rolls back on health
failure. Never request activation with real viewers present.

## Limits

This is evidence-based OCR, not infallible visual understanding. Unrecognised club
abbreviations and channels with no readable score graphic may remain pending. Add
source team aliases or explicit scoreboard codes with regression tests; do not invent
three-letter prefixes or convert unknown evidence into success.

After two consistent observations of a different fixture, new entry tickets for that
match are held with `content_mismatch` until correction. Existing HLS sessions and
unrelated matches are not revoked by the content checker. A pending/unreadable result
is not treated as a proven mismatch and never triggers a blind source replacement.
