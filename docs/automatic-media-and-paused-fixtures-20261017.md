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
- Background discovery yields to queued operator actions after the current probe, preserving untouched leases.
- Scheduled catalog entries never advertise readiness before their assigned preparation has passed.
- Verified source names are installed through the existing locked catalog writer, preserving the catalog sync preference.
- A failed codec edition does not quarantine its account before alternatives have been tried.
- Provider outages, wrong programme content and future supplier failures cannot be ruled out by codec validation.

## Manual Stop

- Public metadata includes `broadcastPaused`, with `resourceStatus: PAUSED` forcing readiness false even for stale snapshots.
- Paused duplicates win deduplication over stale assigned duplicates.
- Live stopped matches sort immediately after live broadcasts, before upcoming fixtures.
- An early preparation window does not move a not-started fixture above actual live matches.
- The card remains visible and opens the exact player match identity with a stopped label.
- The player displays statistics without generating a token, creating HLS or sending supplier heartbeats.
- If already playing, it destroys the media session and cancels reconnect, expiry, stall and heartbeat timers on the next metadata update.
- Ordinary automatic refresh does not resume a manual stop. Existing explicit resume remains required.
- Completed-result calendar-day retention remains unchanged.

## Verification

- Gateway: 257 tests passed, including all ten provider IDs, failed codec alternates, account isolation, bounded discovery, operator priority, readiness and pause handling.
- Frontend: 19 focused publication, loading and retention tests passed in each repository.
- Player production build passed; HLS library and API configuration hashes match the previous live release.
- Local desktop/mobile browser fixtures: newest live, older live, then stopped fixture on both sites.
- The stopped player showed metadata with no video source and zero token, media or heartbeat requests.
- Production deployment and live observations are recorded separately from these local checks.

## Live Observations

- Both public match APIs returned eight paused fixtures with readiness false; none of the ready rows lacked an assignment.
- The existing stopped Neom vs Al-Ettifaq fixture remained in the public list and opened the player statistics page.
- Network observation after player reload recorded zero token, media and heartbeat requests; video had no source and stayed paused.
- The Villarreal and Paris live sources returned H264/AAC segments with aligned timestamps through the shared gateway.
- Gateway and player releases have private backups. Static publication completed for both repositories before the final ordering refinement.
