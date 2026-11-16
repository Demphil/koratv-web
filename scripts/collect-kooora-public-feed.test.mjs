import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectKoooraPublicFeed, writeKoooraSnapshot } from './collect-kooora-public-feed.mjs';

const row = {
  id: 'kooora-1', match_id: 'kooora-1', source: 'kooora', active: true,
  home_team: 'الفريق الأول', away_team: 'الفريق الثاني', league: 'الدوري الإنجليزي الممتاز',
  kickoff_time: '2026-11-16T20:00:00Z', channel: 'beIN SPORTS 1',
  payload: { score: '1 - 0', status: 'LIVE', isLive: true, liveMinute: 42,
    homeLogo: 'https://cdn.example/home.png', channels: ['beIN SPORTS 1'],
    providerPassword: 'never-public', providerUrl: 'https://secret.example/stream.m3u8' },
  providerToken: 'never-public'
};

test('collector reads today and tomorrow, enriches channels, then writes one public snapshot', async () => {
  const calls = [];
  const result = await collectKoooraPublicFeed({
    now: new Date('2026-11-16T12:00:00Z'),
    fetch: async url => { calls.push(url); return '<html>kooora</html>'; },
    parse: (html, options) => {
      assert.equal(html, '<html>kooora</html>');
      return [{ ...structuredClone(row), expectedDate: options.expectedDate }];
    },
    enrich: async rows => { rows[0].payload.channels.push('beIN SPORTS 2'); },
    write: async rows => ({ count: rows.length })
  });

  assert.equal(calls.length, 2);
  assert.equal(result.count, 2);
});

test('snapshot allowlist omits provider credentials and refuses to replace good data with an empty feed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kooora-pages-feed-'));
  const outputPath = join(directory, 'matches.json');
  try {
    await writeFile(outputPath, 'previous-good-feed');
    await assert.rejects(writeKoooraSnapshot([], { outputPath }), /no active matches/);
    assert.equal(await readFile(outputPath, 'utf8'), 'previous-good-feed');

    await writeKoooraSnapshot([row], { outputPath, now: () => Date.parse('2026-11-16T12:00:00Z') });
    const text = await readFile(outputPath, 'utf8');
    const snapshot = JSON.parse(text);
    assert.equal(snapshot.matches.length, 1);
    assert.equal(snapshot.matches[0].channel, 'beIN SPORTS 1');
    assert.deepEqual(snapshot.matches[0].payload.channels, ['beIN SPORTS 1']);
    assert.doesNotMatch(text, /never-public|providerUrl|secret\.example/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

