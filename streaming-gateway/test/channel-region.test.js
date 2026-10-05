import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchChannels, normalizeName, isProviderChannelCompatible, CHANNEL_MATCH_POLICY_VERSION } from '../../shared/provider-channel-match.mjs';
import { preferredBroadcastChannels, reconcileBroadcasts } from '../../shared/match-broadcasts.mjs';
import { selectProviderChannel, createProviderCatalog } from '../provider-catalog.js';
import { applyProviderDiscovery } from '../provider-catalog-update.js';
import { buildAvailableRoutes } from '../scripts/maintenance-sync.js';
import { createProviderLiveResolver } from '../provider-live-resolver.js';

const entry = (name, group, id) => ({ name, rawName: name, group,
  url: `https://provider.example/${id}.m3u8`, search: normalizeName(`${name} ${group}`) });

test('Arabic beIN never selects a French same-name channel even when its quality is preferred', () => {
  const entries = [entry('beIN SPORTS HD 1', 'FR | SPORTS', 'wrong'),
    entry('AR | beIN SPORTS 1 FHD', 'AR | BEIN SPORTS', 'right')];
  const match = matchChannels(['beIN SPORTS HD 1'], entries, { candidatesPerChannel: 30 })[0];
  assert.equal(match.candidates.length, 1);
  assert.equal(selectProviderChannel(match).original_url, entries[1].url);
  assert.equal(selectProviderChannel({ name: match.name, candidates: [
    { source_name: entries[0].name, group: entries[0].group, original_url: entries[0].url }
  ] }), null);
});

test('foreign language markers in brackets, prefixes, suffixes and provider groups cannot bypass matching', () => {
  for (const marker of ['[FR]', 'FR:', 'FR | SPORTS', 'FRENCH', 'France', 'FRANCE UHD', 'ENG', 'TR', 'US']) {
    assert.deepEqual(matchChannels(['beIN SPORTS HD 1'], [entry('beIN SPORTS HD 1', marker, 'foreign')]), []);
    assert.deepEqual(matchChannels(['beIN SPORTS HD 1'], [entry(`${marker} beIN SPORTS HD 1`, '', 'foreign')]), []);
  }
});

test('channel number and beIN product variants remain distinct', () => {
  const entries = [entry('AR | beIN SPORTS 10 HD', 'AR', '10'), entry('AR | beIN SPORTS MAX 1 HD', 'AR', 'max'),
    entry('AR | beIN SPORTS PREMIUM 1 HD', 'AR', 'premium'), entry('beIN SPORTS ENG 1 HD', 'UK', 'en')];
  assert.deepEqual(matchChannels(['beIN SPORTS HD 1'], entries), []);
  assert.equal(matchChannels(['beIN SPORTS ENG 1'], entries)[0].original_url, entries[3].url);
  assert.equal(matchChannels(['beIN SPORTS HD 10'], entries)[0].original_url, entries[0].url);
  assert.deepEqual(matchChannels(['beIN SPORTS XTRA 2'], [entry('AR beIN SPORTS XTRA 1', 'AR', 'xtra1')]), []);
});

test('Arabic region evidence is required instead of guessing from an unlabelled channel name', () => {
  const entries = [entry('beIN SPORTS HD 1', '', 'neutral'), entry('AR | beIN SPORTS 1 FHD', 'AR | SPORTS', 'arabic')];
  const match = matchChannels(['beIN SPORTS HD 1'], entries, { candidatesPerChannel: 30 })[0];
  assert.equal(selectProviderChannel(match).original_url, entries[1].url);
  assert.deepEqual(matchChannels(['beIN SPORTS HD 1'], [entries[0]]), []);
});

test('Kooora Arabic broadcaster selection is identical for metadata and playback candidates', () => {
  const names = ['beIN SPORTS FRANCE 1', 'beIN Sports ENG 1', 'CBC Sport', 'beIN Sports Mena 1'];
  assert.equal(preferredBroadcastChannels(names)[0], 'beIN SPORTS HD 1');
  const row = { match_id: 'fixture', source: 'kooora', payload: { sourceMatchId: '123', channels: names } };
  assert.equal(reconcileBroadcasts([row])[0].channel, 'beIN SPORTS HD 1');
  assert.equal(preferredBroadcastChannels(['CBC Sport', 'AL KASS One'])[0], 'AL KASS One');
});

test('legacy unverified beIN URLs are retained on disk but not exposed as available routes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'region-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'catalog.json');
  const name = 'beIN SPORTS HD 1';
  const data = { providers: { A: { enabled: true } }, channels: {
    [name]: { A: 'https://provider.example/old.m3u8', sourceNames: { A: name } }
  } };
  writeFileSync(path, JSON.stringify(data));
  const catalog = createProviderCatalog({ PROVIDER_CATALOG_PATH: path });
  assert.deepEqual(catalog.sources(name), {});
  assert.deepEqual(buildAvailableRoutes(data), []);
  applyProviderDiscovery(data, 'A', { username: 'test' }, ['https://provider.example'], {
    origin: 'https://provider.example', info: { status: 'Active', max_connections: 1 },
    selected: [{ name, chosen: { source_name: 'AR | beIN SPORTS 1 FHD', group: 'AR | SPORTS', original_url: 'https://provider.example/new.m3u8' } }]
  }, new Date().toISOString());
  assert.equal(data.channels[name].sourcePolicyVersions.A, CHANNEL_MATCH_POLICY_VERSION);
  assert.equal(data.channels[name].sourceGroups.A, 'AR | SPORTS');
  writeFileSync(path, JSON.stringify(data)); catalog.refreshNow();
  assert.equal(catalog.sources(name).A, 'https://provider.example/new.m3u8');
  assert.equal(buildAvailableRoutes(data).length, 1);
  data.channels[name].sourceGroups.A = 'FR | SPORTS';
  writeFileSync(path, JSON.stringify(data)); catalog.refreshNow();
  assert.deepEqual(catalog.sources(name), {});
});

test('live refresh returns actual discovered URLs without mixing Arabic and English channels in one lease', async () => {
  const resolver = createProviderLiveResolver({ staggerMs: 0, accounts: () => ({ A: { enabled: true }, B: { enabled: true } }),
    env: {
      IPTV_PROVIDER_A_JSON: JSON.stringify({ username: 'test', password: 'test', origins: ['https://a.example'] }),
      IPTV_PROVIDER_B_JSON: JSON.stringify({ username: 'test', password: 'test', origins: ['https://b.example'] })
    },
    fetchImpl: async input => {
      const url = new URL(input);
      let body;
      switch (url.searchParams.get('action')) {
        case 'get_live_categories': body = [{ category_id: 1, category_name: 'UK | SPORTS' }, { category_id: 2, category_name: 'AR | SPORTS' }]; break;
        case 'get_live_streams': body = [
          { stream_id: 10, category_id: 1, name: 'beIN SPORTS ENG 1 HD' },
          ...(url.hostname === 'b.example' ? [{ stream_id: 20, category_id: 2, name: 'AR | beIN SPORTS 1 FHD' }] : [])
        ]; break;
        default: body = { user_info: { auth: 1, status: 'Active', max_connections: 1 } };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  const arabic = await resolver.resolve(['beIN SPORTS HD 1', 'beIN SPORTS ENG 1'], { providerIds: ['A', 'B'] });
  assert.equal(arabic.resolvedChannel, 'beIN SPORTS HD 1');
  assert.deepEqual(arabic.provider_sources, { B: 'https://b.example/live/test/test/20.m3u8' });
  const english = await resolver.resolve(['beIN SPORTS ENG 1', 'beIN SPORTS HD 1'], { providerIds: ['A', 'B'] });
  assert.equal(english.resolvedChannel, 'beIN SPORTS ENG 1');
  assert.deepEqual(Object.keys(english.provider_sources), ['A', 'B']);
});

test('operator discovery bypasses cached metadata and verifies fallback variants before saving', async () => {
  const resolver = createProviderLiveResolver({ staggerMs: 0, accounts: () => ({ A: { enabled: true }, B: { enabled: true } }),
    env: Object.fromEntries(['A', 'B'].map(id => [`IPTV_PROVIDER_${id}_JSON`, JSON.stringify({ username: 'test', password: 'test', origins: [`https://${id.toLowerCase()}.example`] })])),
    fetchImpl: async input => {
      const action = new URL(input).searchParams.get('action');
      return new Response(JSON.stringify(action === 'get_live_categories' ? [{ category_id: 1, category_name: 'AR | SPORTS' }]
        : action === 'get_live_streams' ? [{ stream_id: 10, category_id: 1, name: '[AR] BEIN SPORTS 7 HD' }, { stream_id: 20, category_id: 1, name: '[AR] BEIN SPORTS 7 4k' }]
          : { user_info: { auth: 1, status: 'Active', max_connections: 1 } }), { status: 200 });
    } });
  const cached = await resolver.resolve(['beIN SPORTS HD 7'], { providerIds: ['A', 'B'] });
  assert.ok(cached.provider_sources.A.endsWith('/10.m3u8'));
  const probes = [];
  const verified = await resolver.resolve(['beIN SPORTS HD 7'], { providerIds: ['A', 'B'], verifySource: async (id, chosen) => {
    probes.push([id, chosen.source_name]); return chosen.original_url.endsWith('/20.m3u8');
  } });
  assert.deepEqual(probes.map(([id]) => id), ['A', 'A']);
  assert.deepEqual(Object.keys(verified.provider_sources), ['A']);
  assert.ok(verified.provider_sources.A.endsWith('/20.m3u8'));
});

test('beIN EXTRA and XTRA are the same edition and neither can replace the main numbered channel', () => {
  assert.equal(isProviderChannelCompatible('beIN SPORTS HD 7', { name: 'AR | BEIN-SPORTS EXTRA 7 FHD', group: 'AR | SPORTS' }), false);
  assert.equal(isProviderChannelCompatible('beIN SPORTS XTRA 7', { name: 'AR | BEIN-SPORTS EXTRA 7 FHD', group: 'AR | SPORTS' }), true);
});
