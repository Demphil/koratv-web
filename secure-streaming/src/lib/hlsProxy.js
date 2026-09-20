import { sealJson, proxiedUrl } from "./security";

const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function resolveMediaUrl(baseUrl, item) {
  return isAbsoluteUrl(item) ? item : new URL(item, baseUrl).toString();
}

function rewriteUri(line, baseUrl, channelName, requestPath) {
  const cleanLine = line.trim();
  if (!cleanLine || cleanLine.startsWith("#")) return line;
  const targetUrl = resolveMediaUrl(baseUrl, cleanLine);
  const ticket = sealJson({
    url: targetUrl,
    exp: Date.now() + 5 * 60 * 1000
  });
  return proxiedUrl(requestPath, { ticket, channel: channelName });
}

function rewriteAttributeUris(line, baseUrl, channelName, requestPath) {
  return line.replace(/URI="([^"]+)"/g, (_, uri) => {
    const targetUrl = resolveMediaUrl(baseUrl, uri);
    const ticket = sealJson({
      url: targetUrl,
      exp: Date.now() + 5 * 60 * 1000
    });
    const proxy = proxiedUrl(requestPath, { ticket, channel: channelName });
    return `URI="${proxy}"`;
  });
}

export async function fetchUpstream(url, request) {
  const timeoutMs = Number(process.env.STREAM_PROXY_TIMEOUT_MS || 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    headers: {
      "User-Agent": process.env.IPTV_UPSTREAM_USER_AGENT || "VLC/3.0.20 LibVLC/3.0.20",
      "Accept": "*/*"
    },
    redirect: "follow",
    cache: "no-store",
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

export async function proxyPlaylist({ sourceUrl, channelName, request }) {
  const upstream = await fetchUpstream(sourceUrl, request);
  if (!upstream.ok) {
    return new Response("Upstream playlist unavailable.", { status: 502 });
  }

  const body = await upstream.text();
  const requestPath = `/api/stream/${encodeURIComponent(channelName)}`;
  const rewritten = body
    .split(/\r?\n/)
    .map((line) => rewriteUri(
      rewriteAttributeUris(line, sourceUrl, channelName, requestPath),
      sourceUrl,
      channelName,
      requestPath
    ))
    .join("\n");

  return new Response(rewritten, {
    headers: {
      "Content-Type": HLS_CONTENT_TYPE,
      "Cache-Control": "no-store, private"
    }
  });
}

export async function proxyMedia({ sourceUrl, request }) {
  const upstream = await fetchUpstream(sourceUrl, request);
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream media unavailable.", { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "video/mp2t",
      "Cache-Control": "no-store, private"
    }
  });
}
