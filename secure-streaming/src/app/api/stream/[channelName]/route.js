import { auditStreamAccess, getActiveChannelByName } from "../../../../lib/channelStore";
import { proxyMedia, proxyPlaylist } from "../../../../lib/hlsProxy";
import { getClientIp, getSessionId, hashIp, securityHeaders, unsealJson, verifyStreamToken } from "../../../../lib/security";

export async function OPTIONS(request) {
  return new Response(null, { headers: securityHeaders(request) });
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const channelName = decodeURIComponent(resolvedParams.channelName);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const ticket = url.searchParams.get("ticket");
  const ip = getClientIp(request);
  const sessionId = getSessionId(request);

  try {
    verifyStreamToken({ token, channelName, ip, sessionId });
    const channel = await getActiveChannelByName(channelName);
    if (!channel) return new Response("Channel unavailable.", { status: 404, headers: securityHeaders(request) });

    const sealed = ticket ? unsealJson(ticket) : null;
    const sourceUrl = sealed ? sealed.url : channel.original_url;
    if (sealed && sealed.exp < Date.now()) {
      return new Response("Expired media ticket.", { status: 401, headers: securityHeaders(request) });
    }

    await auditStreamAccess({
      channel,
      ipHash: hashIp(ip),
      userAgent: request.headers.get("user-agent"),
      event: ticket ? "segment" : "playlist"
    });

    const isPlaylist = /\.m3u8(?:$|[?#])/i.test(sourceUrl);
    const proxied = isPlaylist
      ? await proxyPlaylist({ sourceUrl, channelName, token, request })
      : await proxyMedia({ sourceUrl, request });

    const headers = new Headers(proxied.headers);
    Object.entries(securityHeaders(request)).forEach(([key, value]) => headers.set(key, value));
    return new Response(proxied.body, { status: proxied.status, headers });
  } catch {
    return new Response("Unauthorized stream request.", { status: 401, headers: securityHeaders(request) });
  }
}
