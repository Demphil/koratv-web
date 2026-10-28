import test from 'node:test';
import assert from 'node:assert/strict';
import { contentWindow, identifyContent, createMatchContentVerifier } from '../match-content.js';
import { parseOcrTsv } from '../content-ocr.js';

const kickoff = Date.parse('2026-10-28T17:30:00Z');
const match = { match_id: 'inter', home_team: 'Venezia', away_team: 'Inter', kickoff_time: new Date(kickoff).toISOString(), payload: { status: 'LIVE' } };
const other = { match_id: 'milan', home_team: 'AC Milan', away_team: 'Bologna', kickoff_time: match.kickoff_time, payload: { status: 'LIVE' } };
const words = text => text.split(' ').map(text => ({ text, confidence: 95 }));
const samples = text => [words(text), words(text)];

test('content checks start exactly 35 minutes before kickoff and exclude ended fixtures', () => {
  assert.equal(contentWindow(match, kickoff - 35 * 60_000 - 1), false);
  assert.equal(contentWindow(match, kickoff - 35 * 60_000), true);
  assert.equal(contentWindow({ ...match, payload: { status: 'RESULT' } }, kickoff), false);
});

test('both sides, a scoreboard and two agreeing frames are necessary', () => {
  assert.equal(identifyContent(match, samples('44:26 VEN 0-0 INT'), [], kickoff + 44 * 60_000).status, 'verified');
  for (const value of [samples('LIVE SPORT 1'), samples('44:26 VEN 0-0'), samples('Venezia Inter'), [words('44:26 VEN 0-0 INT')],
    [words('44:26 VEN 0-0 INT'), words('44:26 MIL 1-0 BOL')]]) {
    assert.equal(identifyContent(match, value, [other], kickoff + 44 * 60_000).status, 'pending');
  }
});

test('a known different fixture is pending before kickoff and a mismatch after it', () => {
  assert.equal(identifyContent(match, samples('40:12 MIL 2-1 BOL'), [other], kickoff - 10 * 60_000).status, 'pending');
  assert.deepEqual(identifyContent(match, samples('40:12 MIL 2-1 BOL'), [other], kickoff + 10 * 60_000),
    { status: 'mismatch', reason: 'different_fixture', observedMatchId: 'milan', samples: 2 });
});

test('same-fixture replays and incompatible match clocks cannot be confirmed', () => {
  assert.equal(identifyContent(match, samples('44:26 VEN 0-0 INT'), [], kickoff - 5 * 60_000).reason, 'replay_clock');
  assert.equal(identifyContent({ ...match, payload: { minute: 8 } }, samples('84:26 VEN 0-0 INT'), [], kickoff + 10 * 60_000).status, 'mismatch');
});

test('a highlights montage with jumping match clocks is not accepted as live identity evidence', () => {
  assert.equal(identifyContent(match, [words('20:10 VEN 0-0 INT'), words('45:10 VEN 0-0 INT')], [], kickoff + 45 * 60_000).status, 'pending');
  const morocco = { ...match, home_team: 'FAR Rabat', away_team: 'Ittihad Tanger' };
  assert.equal(identifyContent(morocco, samples('61:08 FUS 0-0 RCAZ'), [], kickoff + 61 * 60_000).status, 'mismatch');
});

test('OCR confidence and ambiguous opponent codes do not produce false approvals', () => {
  assert.equal(identifyContent(match, [words('44:26 VEN 0-0 INT').map(word => ({ ...word, confidence: 20 })), words('44:26 VEN 0-0 INT')], [], kickoff).status, 'pending');
  const ambiguous = { ...match, home_team: 'Barcelona', away_team: 'Bayern Munich' };
  assert.equal(identifyContent(ambiguous, samples('20:15 FCB 0-0 FCB'), [], kickoff).status, 'pending');
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tVEN\n5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t20\tFAKE';
  assert.deepEqual(parseOcrTsv(tsv), [{ text: 'VEN', confidence: 90 }]);
});

test('bilingual source aliases identify full team names without generated prefix guesses', () => {
  const fixture = { ...match, home_team: 'Local Home', away_team: 'Local Away', payload: {
    homeTeamEnglish: 'Al Faisaly', awayTeamEnglish: 'Al Taawoun' } };
  assert.equal(identifyContent(fixture, samples('06:20 AL FAISALY 0-0 AL TAAWOUN'), [], kickoff + 6 * 60_000).status, 'verified');
});

test('bounded content cache deduplicates OCR and never carries approval to a different provider or source', async () => {
  let calls = 0, now = kickoff + 44 * 60_000;
  const verifier = createMatchContentVerifier({ enabled: true, now: () => now, inspect: async () => { calls++; return samples('44:26 VEN 0-0 INT'); } });
  const input = { match, provider: 'A', source: 'private-source', segment: Buffer.from([1]) };
  await Promise.all([verifier.verify(input), verifier.verify(input)]);
  assert.equal(calls, 1);
  assert.equal((await verifier.verify(input)).status, 'verified');
  assert.equal(calls, 1);
  await verifier.verify({ ...input, provider: 'B' });
  await verifier.verify({ ...input, source: 'renewed-source' });
  assert.equal(calls, 3);
  now += 90_001;
  await verifier.verify(input);
  assert.equal(calls, 4);
});

test('unavailable OCR is explicit pending, never a successful content test or a transport failure', async () => {
  const verifier = createMatchContentVerifier({ enabled: true, now: () => kickoff, inspect: async () => { throw new Error('content_inspector_unavailable'); } });
  assert.equal((await verifier.verify({ match, provider: 'A', source: 'source', segment: Buffer.from([1]) })).status, 'pending');
  const disabled = createMatchContentVerifier({ inspect: () => { throw new Error('must not run'); } });
  assert.equal((await disabled.verify({ match })).status, 'disabled');
});

test('a proven mismatch stays quarantined across expiry and uncertain frames, until the same source shows the correct teams', async () => {
  let now = kickoff + 44 * 60_000, frame = '44:26 MIL 2-1 BOL';
  const verifier = createMatchContentVerifier({ enabled: true, now: () => now, inspect: async () => samples(frame) });
  const input = { match, fixtures: [other], provider: 'A', source: 'wrong-source', segment: Buffer.from([1]) };
  assert.equal((await verifier.verify(input)).blocked, true);
  now += 90_001;
  assert.equal(verifier.latest(input).blocked, true);
  frame = 'STUDIO LIVE';
  assert.equal((await verifier.verify(input)).blocked, true);
  now += 90_001; frame = '44:26 VEN 0-0 INT';
  assert.equal((await verifier.verify(input)).status, 'verified');
  assert.equal(verifier.latest(input).blocked, undefined);
});

test('a cancelled idle probe exits promptly and queued OCR never runs for its expired lease', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const verifier = createMatchContentVerifier({ enabled: true, now: () => kickoff, inspect: async () => { calls++; await gate; return samples('00:10 VEN 0-0 INT'); } });
  const controller = new AbortController();
  const first = verifier.verify({ match, provider: 'A', source: 'a' });
  const pending = verifier.verify({ match, provider: 'B', source: 'b', signal: controller.signal });
  controller.abort();
  assert.equal((await pending).reason, 'content_inspection_cancelled');
  release(); await first; await verifier.idle();
  assert.equal(calls, 1);
});
