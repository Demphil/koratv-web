# Live Resource Scheduling

## Incident Evidence

Runtime diagnostic 37211606401 on 2026-10-04 showed all eight enabled workers
assigned to a whole-day list: seven later fixtures and one finished fixture.
Senegal-Comoros was live but marked no_available_provider. Kyrgyzstan-Lebanon
had no broadcaster in the authoritative match data and could not be assigned
a correct channel merely because a worker was free.

## Changes

- Only live fixtures and those inside the playback preparation window reserve
  workers. Finished, cancelled, and distant fixtures cannot consume capacity.
- Hidden API fixtures cannot reserve workers ahead of the shared Kooora feed;
  the same explicit Gulf Cup supplement used by the public feed is preserved.
- Route reconciliation and resource assignment run every minute. Provider
  channel-link discovery still runs every four hours, independently of viewers.
- A maximum of eight events may be assigned. Provider identities are not
  truncated by list position; disabled account gaps do not hide usable accounts.
- Flexible events can move to another compatible provider to leave a scarce
  provider available for an event with only one supported provider.
- Existing compatible assignments are preferred, avoiding unnecessary changes.
- Manual selection stays effective for eligible events. Future manual choices
  activate automatically when their preparation window opens.
- Kooora Arabic national-team and VIP names participate in priority scoring.
- Obsolete prewarm viewers are released; real viewers are not forcibly evicted.
- Both sites sort active broadcasts by newest kickoff, then upcoming fixtures
  by earliest kickoff, then unselected fixtures. Ended matches stay visible at
  the bottom until the existing daily rollover.

The scheduler uses serialized async work with overlap prevention and the
existing filesystem locks. Node timers are scheduling triggers, not a guarantee
of exact wall-clock execution: https://nodejs.org/api/timers.html.
