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

test('verified Kooora channel aliases resolve to the exact active IPTV channel', async () => {
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
    payload: { isLive: true, status: 'LIVE', broadcast: { source: 'kooora', channels: ['Arryadia HD 3'] } }
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

test('pooled playback takes the refreshed provider URL rather than the stored channel URL', async () => {
  const originalFetch = globalThis.fetch;
  const match = { id: 'refreshed-match', match_id: 'refreshed-match', active: true, source: 'kooora',
    kickoff_time: new Date(Date.now() - 60000).toISOString(), channel: 'beIN SPORTS HD 1',
    payload: { status: 'LIVE', broadcast: { source: 'kooora', channels: ['beIN SPORTS HD 1'] } } };
  const channel = { id: 1, name: 'beIN SPORTS HD 1', active: true,
    original_url: 'https://stale.example/live/old/secret/1.m3u8' };
  globalThis.fetch = async input => {
    const url = new URL(input);
    return Response.json(url.pathname.endsWith('/matches') ? [match] : [channel]);
  };
  const catalog = { override: () => null,
    sources: name => name === channel.name ? { A: 'https://fresh.example/live/new/secret/1.m3u8' } : {} };
  try {
    const playback = await createPlaybackResolver({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' }, 'kooora', catalog)(match.match_id);
    assert.equal(playback.is_streaming_active, true);
    assert.equal(playback.stream_url, catalog.sources(channel.name).A);
    assert.deepEqual(playback.provider_sources, catalog.sources(channel.name));
  } finally { globalThis.fetch = originalFetch; }
});

test('pooled playback can use direct match route state before broadcast matching', async () => {
  const originalFetch = globalThis.fetch;
  const match = { id: 'direct-route-match', match_id: 'direct-route-match', active: true, source: 'kooora',
    kickoff_time: new Date(Date.now() - 60000).toISOString(), channel: null,
    payload: { status: 'LIVE', broadcast: { source: 'kooora', channels: [] } } };
  const channel = { id: 1, name: 'MBC Action', active: true, original_url: 'https://stale.example/live/old/secret/1.m3u8' };
  globalThis.fetch = async input => {
    const url = new URL(input);
    return Response.json(url.pathname.endsWith('/matches') ? [match] : [channel]);
  };
  const catalog = {
    override: () => null,
    matchRoute: id => id === match.match_id ? { resolvedChannel: 'MBC Action', requestedChannels: ['MBC Action'], status: 'RESOLVED' } : null,
    resolve: name => name,
    sources: name => name === channel.name ? { A: 'https://pool.example/live/mbc-action.m3u8' } : {},
  };
  try {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' };
    const [row] = await createMatchesReader(env, 'kooora', catalog)();
    assert.equal(row.source_ready, true);
    assert.equal(row.channel, 'MBC Action');
    const playback = await createPlaybackResolver(env, 'kooora', catalog)(match.match_id);
    assert.equal(playback.is_streaming_active, true);
    assert.equal(playback.channel_id, 'MBC Action');
    assert.equal(playback.stream_url, 'https://pool.example/live/mbc-action.m3u8');
  } finally { globalThis.fetch = originalFetch; }
});

test('reader and ticket resolver skip a listed broadcaster without a provider source and try the next one', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    id: 'alternative-fixture', match_id: 'alternative-fixture', active: true, source: 'kooora',
    kickoff_time: new Date(Date.now() - 60000).toISOString(),
    payload: { status: 'LIVE', broadcast: { source: 'kooora', channels: ['SuperSport Maximo 1', 'SABC Plus'] } },
  };
  const channels = [
    { id: 1, name: 'SuperSport Maximo 1', active: true, original_url: 'https://media.example.com/1.m3u8' },
    { id: 2, name: 'SABC Plus', active: true, original_url: 'https://media.example.com/2.m3u8' },
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/matches')) return Response.json([fixture]);
    const nameFilter = url.searchParams.get('name');
    if (nameFilter) {
      const requested = nameFilter.replace(/^eq\./, '');
      return Response.json(channels.filter((channel) => channel.name === requested));
    }
    return Response.json(channels);
  };
  const catalog = {
    override: () => null,
    sources: (name) => name === 'SABC Plus' ? { A: 'https://pool.example/live/sabc.m3u8' } : {},
  };
  try {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' };
    const [row] = await createMatchesReader(env, 'kooora', catalog)();
    assert.equal(row.source_ready, true);
    assert.equal(row.channel, 'SABC Plus');

    const playback = await createPlaybackResolver(env, 'kooora', catalog)(fixture.match_id);
    assert.equal(playback.is_streaming_active, true);
    assert.equal(playback.channel_id, 'SABC Plus');
    assert.equal(playback.stream_url, 'https://pool.example/live/sabc.m3u8');
  } finally { globalThis.fetch = originalFetch; }
});

test('pooled playback resolves a Kooora broadcaster directly from provider catalog aliases', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    id: 'alias-fixture', match_id: 'alias-fixture', active: true, source: 'kooora',
    kickoff_time: new Date(Date.now() - 60000).toISOString(),
    payload: { status: 'LIVE', broadcast: { source: 'kooora', channels: ['SABC Plus'] } },
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    return Response.json(url.pathname.endsWith('/matches') ? [fixture] : []);
  };
  const catalog = {
    override: () => null,
    resolve: (name) => name === 'SABC Plus' ? 'SABC+ HD' : null,
    sources: (name) => ['SABC Plus', 'SABC+ HD'].includes(name) ? { A: 'https://pool.example/live/sabc-plus.m3u8' } : {},
  };
  try {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' };
    const [row] = await createMatchesReader(env, 'kooora', catalog)();
    assert.equal(row.source_ready, true);
    assert.equal(row.channel, 'SABC+ HD');

    const playback = await createPlaybackResolver(env, 'kooora', catalog)(fixture.match_id);
    assert.equal(playback.is_streaming_active, true);
    assert.equal(playback.channel_id, 'SABC+ HD');
    assert.equal(playback.stream_url, 'https://pool.example/live/sabc-plus.m3u8');
  } finally { globalThis.fetch = originalFetch; }
});

test('pooled playback explains whether a Kooora channel missed the provider catalog', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    id: 'missing-catalog-fixture', match_id: 'missing-catalog-fixture', active: true, source: 'kooora',
    kickoff_time: new Date(Date.now() - 60000).toISOString(),
    payload: { status: 'LIVE', broadcast: { source: 'kooora', channels: ['SABC Plus'] } },
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    return Response.json(url.pathname.endsWith('/matches') ? [fixture] : []);
  };
  const catalog = {
    override: () => null,
    resolve: () => null,
    sources: () => ({}),
  };
  try {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key' };
    const playback = await createPlaybackResolver(env, 'kooora', catalog)(fixture.match_id);
    assert.equal(playback.is_streaming_active, false);
    assert.equal(playback.reason, 'source_unavailable');
    assert.deepEqual(playback.diagnostics.requestedChannels, ['SABC Plus']);
    assert.equal(playback.diagnostics.attempts[0].requestedName, 'SABC Plus');
    assert.equal(playback.diagnostics.attempts[0].providerCount, 0);
  } finally { globalThis.fetch = originalFetch; }
});
