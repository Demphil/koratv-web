# Automatic Media Validation and Paused Fixtures

Scope: gateway preparation, public match lists on both sites, and player stop state.
DNS, Supabase, workflow definitions, provider credentials and HLS transport settings are unchanged.

## Readiness and Recovery

- Scheduled preparation validates the media segment, not just manifest and segment HTTP status.
- Browser-compatible H264 video, compatible audio and aligned timestamps are required.
- The background monitor also rejects manifests that stop progressing across checks.
- Root playback rejects a newly acquired, unverified source until it passes validation.
- A failed edition triggers a serial search on that same provider and exact canonical channel.
- Candidate probes own the provider slot; a different channel's occupied account cannot be borrowed.
- Shared viewers of the same broken channel can use its repaired edition. Other channels are untouched.
- Discovery is coalesced, capped at eight probes and a 45-second probe deadline per repair.
- Failed searches back off for five minutes. Media inspection is cached for one minute.
- Verified source names are installed through the existing locked catalog writer, preserving the catalog sync preference.
- A failed codec edition does not quarantine its account before alternatives have been tried.
- Provider outages, wrong programme content and future supplier failures cannot be ruled out by codec validation.

## Manual Stop

- Public metadata includes `broadcastPaused`, with `resourceStatus: PAUSED` forcing readiness false even for stale snapshots.
- Paused duplicates win deduplication over stale assigned duplicates.
- Live stopped matches sort immediately after live broadcasts, before upcoming fixtures.
- The card remains visible and opens the exact player match identity with a stopped label.
- The player displays statistics without generating a token, creating HLS or sending supplier heartbeats.
- If already playing, it destroys the media session and cancels reconnect, expiry, stall and heartbeat timers on the next metadata update.
- Ordinary automatic refresh does not resume a manual stop. Existing explicit resume remains required.
- Completed-result calendar-day retention remains unchanged.

## Verification

- Gateway: 256 tests passed, including all ten provider IDs, failed codec alternates, account isolation, bounded discovery, readiness and pause handling.
- Frontend: 19 focused publication, loading and retention tests passed in each repository.
- Player production build passed; HLS library and API configuration hashes match the previous live release.
- Local desktop/mobile browser fixtures: newest live, older live, then stopped fixture on both sites.
- The stopped player showed metadata with no video source and zero token, media or heartbeat requests.
- Production deployment and live observations are recorded separately from these local checks.
