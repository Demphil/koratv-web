import { parseM3uText, normalizeName, matchChannels } from '../secure-streaming/scripts/import-m3u.js';
import { selectProviderChannel } from './provider-catalog.js';

export const PROVIDER_USER_AGENT = 'IPTVSmartersPlayer';
const sport = /sport|bein|arryadia|arriadia|ssc|alkass|الرياض|رياضي|الكأس|الكاس/i;

export function credentialsFromCatalog(account) {
  if (!account?.sourceUrl) return null;
  try {
    const url = new URL(account.sourceUrl), parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'live' || parts.length < 4) return null;
    return { username: decodeURIComponent(parts[1]), password: decodeURIComponent(parts[2]), origins: account.origins?.length ? account.origins : [url.origin] };
  } catch { return null; }
}

export async function providerApi(credentials, origin, action = '', fetchImpl = fetch) {
  const url = new URL('/player_api.php', origin);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  if (action) url.searchParams.set('action', action);
  const response = await fetchImpl(url, { headers: { 'User-Agent': PROVIDER_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function providerM3u(credentials, origin, fetchImpl = fetch) {
  const url = new URL('/get.php', origin);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  url.searchParams.set('type', 'm3u_plus');
  url.searchParams.set('output', 'ts');
  const response = await fetchImpl(url, { headers: { 'User-Agent': PROVIDER_USER_AGENT, Accept: 'application/x-mpegURL' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (!body.startsWith('#EXTM3U')) throw new Error('invalid_m3u');
  return parseM3uText(body).filter(entry => sport.test(`${entry.name} ${entry.group}`));
}

export async function discoverProvider(credentials, origins, canonicalNames, { fetchImpl = fetch, retry = 2 } = {}) {
  const attempts = [];
  for (const candidate of [...new Set(origins.filter(Boolean))]) {
    const origin = new URL(candidate).origin;
    let metadata;
    try { metadata = await providerApi(credentials, origin, '', fetchImpl); }
    catch (error) { attempts.push({ origin, error: error.message }); continue; }
    const info = metadata?.user_info;
    attempts.push({ origin, status: info?.status || null, auth: Number(info?.auth) === 1, exp_date: info?.exp_date || null,
      max_connections: Number(info?.max_connections) || 0, active_cons: Number(info?.active_cons) || 0 });
    if (Number(info?.auth) !== 1 || /^(Expired|Disabled|Banned)$/i.test(info?.status || '')) continue;
    let categories = null, streams = null, source = 'get_live_streams';
    for (let i = 0; i < retry && !Array.isArray(categories); i++) {
      try { const value = await providerApi(credentials, origin, 'get_live_categories', fetchImpl); if (Array.isArray(value)) categories = value; } catch {}
    }
    for (let i = 0; i < retry && !Array.isArray(streams); i++) {
      try { const value = await providerApi(credentials, origin, 'get_live_streams', fetchImpl); if (Array.isArray(value)) streams = value; } catch {}
    }
    let entries = [];
    if (Array.isArray(streams)) {
      const groupById = new Map((categories || []).filter(x => x && typeof x === 'object').map(x => [String(x.category_id), String(x.category_name || '')]));
      const sportIds = new Set([...groupById].filter(([,name]) => sport.test(name)).map(([id]) => id));
      entries = streams.filter(x => x && typeof x === 'object' && /^\d+$/.test(String(x.stream_id))
        && (sportIds.has(String(x.category_id)) || sport.test(String(x.name || ''))))
        .map(x => ({ name: String(x.name || ''), rawName: String(x.name || ''), group: groupById.get(String(x.category_id)) || '',
          url: new URL(`/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${x.stream_id}.m3u8`, origin).href }))
        .map(x => ({ ...x, search: normalizeName(`${x.name} ${x.group}`) }));
    }
    if (!entries.length) {
      try {
        const m3u = await providerM3u(credentials, origin, fetchImpl);
        entries = m3u.map(x => ({ ...x, url: x.url.replace(/\.ts(?=\?|$)/i, '.m3u8') }));
        source = 'get.php';
      } catch (error) { attempts.at(-1).catalogError = error.message; }
    }
    const selected = matchChannels(canonicalNames, entries, { candidatesPerChannel: 30 })
      .map(match => ({ name: match.name, chosen: selectProviderChannel(match) })).filter(x => x.chosen);
    attempts.at(-1).catalogSource = source;
    attempts.at(-1).sportsStreams = entries.length;
    attempts.at(-1).matchedChannels = selected.length;
    if (selected.length) return { origin, info, attempts, selected, source };
  }
  return { origin: null, info: null, attempts, selected: [] };
}
