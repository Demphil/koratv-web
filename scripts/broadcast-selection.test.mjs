import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTED_BROADCAST_IDS, isSelectedBroadcast } from '../shared/broadcast-selection.mjs';
import { normalizeWebsiteMatch } from '../shared/public-match-feed.mjs';

test('only the four selected dated Kooora fixtures are marked for broadcast', () => {
  assert.equal(SELECTED_BROADCAST_IDS.length, 4);
  for (const id of SELECTED_BROADCAST_IDS) {
    assert.equal(isSelectedBroadcast(id), true);
    assert.equal(isSelectedBroadcast(id.replace('2026-11-27', '2026-11-28')), false);
    const match = normalizeWebsiteMatch({ match_id: id, home_team: 'Home', away_team: 'Away',
      kickoff_time: '2026-11-27T19:45:00Z', source: 'kooora' });
    assert.equal(match.selectedForBroadcast, true);
  }
  assert.equal(isSelectedBroadcast('unknown'), false);
});
