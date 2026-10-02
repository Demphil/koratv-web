import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAvailableRoutes, resolveRouteName, runMaintenanceSync } from '../scripts/maintenance-sync.js';

test('route matcher ignores quality labels while preserving channel numbers', () => {
  const routes = buildAvailableRoutes({
    providers: { A: { enabled: true }, B: { enabled: true } },
    channels: {
      'beIN SPORTS HD 1': { A: 'hidden', sourceNames: { A: 'AR beIN Sports 1 FHD' } },
      'beIN SPORTS HD 2': { B: 'hidden', sourceNames: { B: 'AR beIN Sports 2 4K' } },
    },
  });
  assert.equal(resolveRouteName('beIN Sports Mena 1', routes).matchedName, 'beIN SPORTS HD 1');
  assert.equal(resolveRouteName('beIN Sports Mena 2', routes).matchedName, 'beIN SPORTS HD 2');
});

test('maintenance sync writes opaque route ids without playback URLs', async () => {
  const originalFetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), 'active-catalog-'));
  await writeFile(join(dir, 'provider-catalog.json'), JSON.stringify({
    providers: { A: { enabled: true } },
    channels: {
      'SABC Plus': {
        A: 'https://private.example/live/user/pass/123.m3u8',
        sourceNames: { A: 'SABC+ HD' },
      },
    },
  }));
  const fixture = {
    id: 'fixture-1',
    match_id: 'fixture-1',
    home_team: 'A',
    away_team: 'B',
    league: 'Test',
    source: 'kooora',
    active: true,
    kickoff_time: '2026-09-30T18:00:00.000Z',
    channel: null,
    payload: { broadcast: { source: 'kooora', channels: ['SABC Plus'] } },
  };
  globalThis.fetch = async () => Response.json([fixture]);
  try {
    const summary = await runMaintenanceSync({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      PROVIDER_POOL_DIR: dir,
      ROUTE_SYNC_DATE: '2026-09-30',
      ROUTE_SYNC_TIMEZONE: 'UTC',
    });
    assert.equal(summary.activeRoutes, 1);
    assert.equal(summary.missingRoutes, 0);
    const active = JSON.parse(await readFile(join(dir, 'active-catalog.json'), 'utf8'));
    assert.equal(active.matches['fixture-1'].routes[0].routeId, 'channel:SABC Plus');
    assert.equal(JSON.stringify(active).includes('private.example'), false);
    const routeState = JSON.parse(await readFile(join(dir, 'direct-match-route-state.json'), 'utf8'));
    assert.equal(routeState.matches['fixture-1'].requestedChannel, 'SABC Plus');
    assert.equal(routeState.matches['fixture-1'].resolvedChannel, 'SABC Plus');
    assert.equal(routeState.matches['fixture-1'].status, 'RESOLVED');
    assert.equal(JSON.stringify(routeState).includes('private.example'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maintenance sync normalizes direct SNRT fallback rows to Arryadia TNT', async () => {
  const originalFetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), 'active-catalog-snrt-'));
  await writeFile(join(dir, 'provider-catalog.json'), JSON.stringify({
    providers: { A: { enabled: true } },
    channels: {
      'Arryadia TNT': {
        A: 'https://private.example/live/user/pass/456.m3u8',
        sourceNames: { A: 'AR-SPI MA ARRYADIA TNT' },
      },
    },
  }));
  const fixture = {
    id: 'fixture-snrt',
    match_id: 'fixture-snrt',
    home_team: 'وداد تمارة',
    away_team: 'إتحاد تواركة',
    league: 'الدوري المغربي الممتاز',
    source: 'kooora',
    active: true,
    kickoff_time: '2026-10-02T18:00:00.000Z',
    channel: 'SNRT Live',
    payload: { status: 'LIVE', channel: 'SNRT Live' },
  };
  globalThis.fetch = async () => Response.json([fixture]);
  try {
    const summary = await runMaintenanceSync({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      PROVIDER_POOL_DIR: dir,
      ROUTE_SYNC_DATE: '2026-10-02',
      ROUTE_SYNC_TIMEZONE: 'UTC',
    });
    assert.equal(summary.activeRoutes, 1);
    assert.equal(summary.missingRoutes, 0);
    const routeState = JSON.parse(await readFile(join(dir, 'direct-match-route-state.json'), 'utf8'));
    assert.deepEqual(routeState.matches['fixture-snrt'].requestedChannels, ['Arryadia TNT']);
    assert.equal(routeState.matches['fixture-snrt'].resolvedChannel, 'Arryadia TNT');
    assert.equal(routeState.matches['fixture-snrt'].status, 'RESOLVED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
