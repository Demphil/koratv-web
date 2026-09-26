import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../config.js';

const config = loadConfig();
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function canonicalize(urlValue) {
  const url = new URL(urlValue);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0].toLowerCase() === 'live') return url;
  const id = parts[2].replace(/\.(?:ts|m3u8)$/i, '');
  if (!id) return url;
  url.pathname = `/live/${parts[0]}/${parts[1]}/${id}.m3u8`;
  url.search = '';
  return url;
}

const { data, error } = await client
  .from('channels')
  .select('name,active,original_url,quality_variants')
  .in('name', ['Arryadia TNT', 'Arryadia S/D']);

if (error) throw new Error(`Arryadia source probe could not read channels (${error.code || 'storage'})`);

for (const channel of data || []) {
  const sources = [channel.original_url, ...(channel.quality_variants || []).map((item) => item.url)]
    .filter(Boolean);
  for (const sourceValue of [...new Set(sources)]) {
    const source = canonicalize(sourceValue);
    const quality = sourceValue === channel.original_url
      ? 'default'
      : (channel.quality_variants || []).find((item) => item.url === sourceValue)?.label || 'variant';
    const profiles = [
      { client: 'configured', headers: { 'User-Agent': config.upstreamUserAgent } },
      { client: 'provider-sync', headers: { 'User-Agent': 'koratvProviderSync/1.0' } },
      {
        client: 'browser',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          Referer: `${source.origin}/`
        }
      }
    ];
    for (const profile of profiles) {
      let status = 0;
      let validManifest = false;
      let errorType = '';
      try {
        const response = await fetch(source, {
          redirect: 'follow',
          headers: {
            Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
            ...profile.headers
          },
          signal: AbortSignal.timeout(8000)
        });
        status = response.status;
        if (response.ok) validManifest = (await response.text()).trimStart().startsWith('#EXTM3U');
        else await response.body?.cancel();
      } catch (error) {
        errorType = error?.name === 'TimeoutError' ? 'timeout' : 'network';
      }
      console.log(JSON.stringify({
        channel: channel.name,
        active: channel.active,
        quality,
        client: profile.client,
        rootAllowed: config.upstreamOrigins.has(source.origin),
        status,
        validManifest,
        error: errorType || undefined
      }));
      if (validManifest) break;
    }
  }
}
