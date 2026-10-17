# Match Stop Control and Compatible Channel Approval

## Villarreal - Elche Incident

The protected gateway returned HTTP 200 for manifests and transport-stream segments,
but the browser remained at time zero without a playable buffer. Inspection through
the existing gateway (not a second direct supplier connection) found HEVC video and
AAC audio. Video began at 3420.300 seconds while audio began at 98092.496 seconds.
An HTTP-only segment check had incorrectly accepted this source as ready.

Operator channel approval now inspects the already-downloaded segment with the
server's installed `ffprobe`. Approval requires H.264 video, supported AAC/MP3 audio,
and aligned timestamps, allowing the MPEG timestamp wrap. Inspection uses at most
8 MiB, has a six-second process limit, bounds output, and never exposes raw source
URLs. The independent probe is coalesced and bounded. Ordinary viewer requests do
not spawn ffprobe or open an extra supplier connection.

The existing protected operator discovery rejected the HEVC edition and approved
an H.264/AAC edition on supplier B for the same beIN SPORTS HD 5 channel. Both audio
and video then started at 10390.000 seconds. Browser verification showed 1920x1080,
readyState 4, paused false, and playback advancing from 20 to 89 seconds. The image
showed Villarreal in yellow and Elche in white/green, not a different match.
Catalog refresh already honors `mediaVerifiedNames`, preserving the approved edition.

## Stop and Resume

- Authenticated, CSRF-protected, serialized stop/resume jobs.
- Stop persists a Morocco-day manual pause for the canonical fixture and aliases,
  frees its reservation, rotates only affected control versions, and invalidates
  playback before resource reconciliation. Scores remain visible.
- Stopped sessions cannot acquire video. Bulk link renewal cannot resume a paused
  fixture, and manual stops require the explicit Resume action.
- Resume tests the source before clearing the pause; a failed probe leaves it stopped.
- Stopping a shared channel preserves the other fixture's media lease and heartbeat.
- Metadata-only refresh/stop reconciliation no longer probes every active channel.

## Verification and Deployment

- 238 gateway tests passed, including actual pool lease isolation, shared-channel
  heartbeat preservation, stop authentication/CSRF/idempotency, alias handling,
  explicit resume, codecs, timestamp wrap, and probe failures.
- Local mobile UI: 390x844, no horizontal overflow, stop buttons at least 40px high.
- Live console shows Stop; the live targeted renewal completed on B. No unrelated
  supplier was taken over for testing. Stop/resume UI QA used synthetic fixtures.
- Backup: `/opt/koratv/backups/stop-media-20261017` (code, catalog, operator state).
- Two controlled gateway reloads delivered the controls and final shared-resource
  protection. DNS, Supabase project, SSH route, provider credentials, and player/HLS
  transport assets were not changed. Reloads are not zero-downtime in single-fork PM2.
- Local proof files are under `.local/`; private diagnostic scripts and unrelated
  untracked files are not part of the commit.
