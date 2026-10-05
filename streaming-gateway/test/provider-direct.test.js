import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProvider, PROVIDER_USER_AGENT } from '../provider-direct.js';
import { isProviderChannelCompatible, normalizeName } from '../../shared/provider-channel-match.mjs';

const credentials = { username: 'sample', password: 'private', origins: ['https://one.example','https://two.example'] };
const streams = [{ name: 'AR - BEIN SPORTS 1 HD', category_id: 8, stream_id: 123 }];

test('4K quality is not channel number 4 and different beIN channel numbers never match', () => {
  assert.equal(normalizeName('[AR] BEIN SPORTS 1 4k'), 'bein sport 1');
  assert.equal(isProviderChannelCompatible('beIN SPORTS HD 4', { name: '[AR] BEIN SPORTS 1 4k' }), false);
  assert.equal(isProviderChannelCompatible('beIN SPORTS HD 4', { name: '[AR] BEIN SPORTS 4 4k' }), true);
  assert.equal(isProviderChannelCompatible('beIN SPORTS HD 1', { name: '[AR] BEIN SPORTS 4 4k' }), false);
});

test('invalid categories do not block direct streams and every request carries the player user agent', async () => {
  const actions = [];
  const fetchImpl = async (url, options) => {
    actions.push({ host: url.host, action: url.searchParams.get('action'), ua: options.headers['User-Agent'] });
    if (!url.searchParams.has('action')) return Response.json({ user_info: { auth: 1, status: 'Active', max_connections: '1' } });
    if (url.searchParams.get('action') === 'get_live_categories') return Response.json({ error: 'broken' });
    return Response.json(streams);
  };
  const result = await discoverProvider(credentials, credentials.origins, ['beIN SPORTS HD 1'], { fetchImpl });
  assert.equal(result.selected.length, 1);
  assert.equal(result.source, 'get_live_streams');
  assert.equal(result.origin, 'https://one.example');
  assert.ok(actions.every(x => x.ua === PROVIDER_USER_AGENT));
});

test('when streams are invalid, direct M3U rebuilds a matching HLS source', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/get.php') return new Response('#EXTM3U\n#EXTINF:-1 group-title="Sports",AR - BEIN SPORTS 1 HD\nhttps://one.example/live/sample/private/456.ts');
    if (!url.searchParams.has('action')) return Response.json({ user_info: { auth: 1, status: 'Active' } });
    return Response.json({ bad: true });
  };
  const result = await discoverProvider(credentials, ['https://one.example'], ['beIN SPORTS HD 1'], { fetchImpl });
  assert.equal(result.source, 'get.php');
  assert.equal(result.selected.length, 1);
  assert.match(result.selected[0].chosen.original_url, /456\.m3u8$/);
});

test('expired host is never reused and the next host is queried directly', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url.host);
    if (!url.searchParams.has('action')) return Response.json({ user_info: { auth: 1, status: url.host === 'one.example' ? 'Expired' : 'Active' } });
    if (url.searchParams.get('action') === 'get_live_categories') return Response.json([]);
    return Response.json(streams);
  };
  const result = await discoverProvider(credentials, credentials.origins, ['beIN SPORTS HD 1'], { fetchImpl });
  assert.equal(result.origin, 'https://two.example');
  assert.equal(result.selected.length, 1);
  assert.deepEqual(seen.slice(0,2), ['one.example','two.example']);
});

test('media verification rejects a broken preferred variant and selects a compatible working variant', async () => {
  const tested = [];
  const fetchImpl = async url => {
    if (!url.searchParams.has('action')) return Response.json({ user_info: { auth: 1, status: 'Active' } });
    if (url.searchParams.get('action') === 'get_live_categories') return Response.json([]);
    return Response.json([
      { name: 'AR - BEIN SPORTS 1 HD', stream_id: 123 },
      { name: 'AR - BEIN SPORTS 1 FHD', stream_id: 456 },
      { name: 'FR - BEIN SPORTS 1 HD', stream_id: 999 }
    ]);
  };
  const result = await discoverProvider(credentials, ['https://one.example'], ['beIN SPORTS HD 1'], {
    fetchImpl, verifySource: async chosen => { tested.push(chosen.original_url); return chosen.original_url.endsWith('/456.m3u8'); }
  });
  assert.equal(result.selected.length, 1);
  assert.match(result.selected[0].chosen.original_url, /456\.m3u8$/);
  assert.equal(tested.length, 2);
  assert.ok(tested.every(url => !url.includes('/999.')));
});

test('active metadata does not prevent trying a second origin when all media variants fail', async () => {
  const fetchImpl = async url => {
    if (!url.searchParams.has('action')) return Response.json({ user_info: { auth: 1, status: 'Active' } });
    if (url.searchParams.get('action') === 'get_live_categories') return Response.json([]);
    return Response.json(streams);
  };
  const result = await discoverProvider(credentials, credentials.origins, ['beIN SPORTS HD 1'], {
    fetchImpl, verifySource: async chosen => new URL(chosen.original_url).hostname === 'two.example'
  });
  assert.equal(result.origin, 'https://two.example');
  assert.equal(result.selected.length, 1);
});

test('scheduled discovery prefers a previously media-verified compatible variant', async () => {
  const fetchImpl = async url => {
    if (!url.searchParams.has('action')) return Response.json({ user_info: { auth: 1, status: 'Active' } });
    if (url.searchParams.get('action') === 'get_live_categories') return Response.json([]);
    return Response.json([{ name: 'AR - BEIN SPORTS 1 HD', stream_id: 123 }, { name: '[AR] BEIN SPORTS 1 4k', stream_id: 456 }]);
  };
  const result = await discoverProvider(credentials, ['https://one.example'], ['beIN SPORTS HD 1'], {
    fetchImpl, preferredSourceNames: { 'beIN SPORTS HD 1': '[AR] BEIN SPORTS 1 4k' }
  });
  assert.match(result.selected[0].chosen.original_url, /456\.m3u8$/);
});
