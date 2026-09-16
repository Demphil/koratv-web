import { getActiveChannelByName, getChannelLanguageAlternatives } from "../../../../lib/channelStore";
import { securityHeaders } from "../../../../lib/security";

const SUPPORTED_LANGUAGES = new Set(["fr", "en"]);

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const channelName = decodeURIComponent(resolvedParams.channelName);
    const matchId = request.nextUrl.searchParams.get("matchId") || "";
    const alternatives = await getChannelLanguageAlternatives(channelName, matchId);

    const safeAlternatives = [];
    const seen = new Set();
    for (const item of alternatives) {
      const language = String(item.language || "").toLowerCase();
      if (!SUPPORTED_LANGUAGES.has(language) || !item.channel_name) continue;
      const channel = await getActiveChannelByName(item.channel_name);
      if (!channel) continue;
      const key = `${language}:${channel.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      safeAlternatives.push({ language, channelName: channel.name });
    }

    return Response.json({ alternatives: safeAlternatives }, { headers: securityHeaders(request) });
  } catch {
    return Response.json({ alternatives: [] }, { headers: securityHeaders(request) });
  }
}
