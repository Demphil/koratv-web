import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchesReader, createPlaybackResolver } from '../supabase.js';

test('unassigned fixtures never inherit the global default channel', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    id: 'api-football_2026-09-26_england_vs_spain',
    match_id: 'api-football_2026-09-26_england_vs_spain',
    home_team: 'England',
    away_team: 'Spain',
    source: 'api-football',
    active: true,
    kickoff_time: new Date(Date.now() - 2 * 60_000).toISOString(),
    channel: null,
    payload: { isLive: true }
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const rows = url.pathname.endsWith('/matches') ? [fixture] : [];
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  };
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    DEFAULT_LIVE_CHANNEL: 'beIN SPORTS HD 1',
    STREAM_CLOSES_AFTER_MINUTES: '180'
  };
  try {
    const matches = await createMatchesReader(env)();
    assert.equal(matches[0].source_ready, false);
    const playback = await createPlaybackResolver(env)(fixture.match_id);
    assert.deepEqual(playback, { is_streaming_active: false, reason: 'channel_unavailable' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Kooora legacy channel aliases resolve to the exact active IPTV channel', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    id: '2026-09-26_wydad_tamara_vs_wydad_riyadi',
    match_id: '2026-09-26_wydad_tamara_vs_wydad_riyadi',
    home_team: 'Widad Témara',
    away_team: 'Wydad AC',
    source: 'kooora-today-matches',
    league: 'الدوري المغربي الممتاز',
    active: true,
    kickoff_time: new Date(Date.now() - 2 * 60_000).toISOString(),
    channel: 'Arryadia HD 3',
    payload: { isLive: true, status: 'LIVE' }
  };
  const channel = {
    id: 3,
    name: 'الرياضية المغربية 3',
    active: true,
    original_url: 'https://media.example.com/live/user/pass/3.m3u8'
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const body = url.pathname.endsWith('/matches')
      ? [fixture]
      : url.searchParams.has('name')
        ? []
        : [channel];
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    STREAM_CLOSES_AFTER_MINUTES: '180'
  };
  try {
    const matches = await createMatchesReader(env, ['kooora', 'metascrape', 'kooora-today-matches'])();
    assert.equal(matches[0].source_ready, true);

    const playback = await createPlaybackResolver(env, ['kooora', 'metascrape', 'kooora-today-matches'])(fixture.match_id);
    assert.equal(playback.is_streaming_active, true);
    assert.equal(playback.channel_id, 'الرياضية المغربية 3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reader and ticket resolver choose an available broadcaster from the verified list', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    id: 'api-fixture', match_id: 'api-fixture', active: true, source: 'api-football',
    kickoff_time: new Date(Date.now() - 60000).toISOString(), channel: 'SNRT Live',
    payload: { status: 'HT', broadcast: { source: 'kooora', channels: ['SNRT Live', 'Arryadia HD 3'] } },
  };
  const channel = { id: 1, name: 'Arryadia TNT', active: true, original_url: 'https://media.example.com/live/1.m3u8' };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const body = url.pathname.endsWith('/matches') ? [fixture]
      : url.searchParams.has('name') ? [] : [channel];
    return Response.json(body);
  };
  try {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' };
    const [row] = await createMatchesReader(env)();
    assert.equal(row.source_ready, true);
    assert.equal(row.channel, 'Arryadia TNT');
    const playback = await createPlaybackResolver(env)(fixture.match_id);
    assert.equal(playback.channel_id, row.channel);
    assert.equal(playback.is_streaming_active, true);
  } finally { globalThis.fetch = originalFetch; }
});
