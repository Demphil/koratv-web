import fs from "node:fs";
import path from "node:path";
import { getActiveChannelByName } from "../../../../../lib/channelStore";
import { getClientIp, getSessionId, securityHeaders, verifyStreamToken } from "../../../../../lib/security";
import { ensureTranscoder, hlsOutputDir, masterPlaylistPath } from "../../../../../server/transcoder";

const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t"
};

function withToken(uri, token) {
  if (!uri || uri.startsWith("#")) return uri;
  const separator = uri.includes("?") ? "&" : "?";
  return uri + separator + "token=" + encodeURIComponent(token);
}

function rewritePlaylist(content, token) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return withToken(trimmed, token);
    })
    .join("\n");
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const channelName = decodeURIComponent(resolvedParams.channelName);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  try {
    verifyStreamToken({ token, channelName, ip: getClientIp(request), sessionId: getSessionId(request) });
    const channel = await getActiveChannelByName(channelName);
    if (!channel) return new Response("Channel unavailable.", { status: 404, headers: securityHeaders(request) });

    ensureTranscoder({ channelName, sourceUrl: channel.original_url });

    const requested = resolvedParams.path?.length ? resolvedParams.path.join("/") : "master.m3u8";
    const outputDir = hlsOutputDir(channelName);
    const filePath = path.resolve(outputDir, requested);
    if (!filePath.startsWith(outputDir)) {
      return new Response("Invalid path.", { status: 400, headers: securityHeaders(request) });
    }

    const start = Date.now();
    while (!fs.existsSync(filePath) && Date.now() - start < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const fallback = requested === "master.m3u8" ? masterPlaylistPath(channelName) : filePath;
    if (!fs.existsSync(fallback)) return new Response("Transcode output not ready.", { status: 503, headers: securityHeaders(request) });

    const ext = path.extname(fallback);
    const body = ext === ".m3u8"
      ? rewritePlaylist(fs.readFileSync(fallback, "utf8"), token)
      : fs.readFileSync(fallback);

    return new Response(body, {
      headers: {
        ...securityHeaders(request),
        "Content-Type": TYPES[ext] || "application/octet-stream"
      }
    });
  } catch {
    return new Response("Unauthorized ABR request.", { status: 401, headers: securityHeaders(request) });
  }
}
