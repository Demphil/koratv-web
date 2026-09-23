import { getSupabaseAdmin } from "./supabaseAdmin";

export const SITE_NAME = "koratv Football";
export const CANONICAL_ORIGIN = (process.env.NEXT_PUBLIC_CANONICAL_ORIGIN || "https://koratv.click").replace(/\/$/, "");

const UNKNOWN_CHANNELS = new Set(["", "غير محدد", "غير معروف", "unknown", "تحدد لاحقا", "تحدد لاحقاً"]);

function safeText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function isKnownChannel(value) {
  return !UNKNOWN_CHANNELS.has(safeText(value).toLowerCase());
}

export function absoluteUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${CANONICAL_ORIGIN}${normalizedPath}`;
}

export function watchUrl(channelName, matchId = "") {
  const publicId = opaqueWatchId(matchId || channelName);
  return absoluteUrl(`/watch/${publicId}`);
}

export function embedUrl(channelName, matchId = "") {
  const publicId = opaqueWatchId(matchId || channelName);
  return absoluteUrl(`/embed/${publicId}`);
}

export function opaqueWatchId(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash).padStart(10, "0");
}

function isOpaqueId(value) {
  return /^\d{8,}$/.test(safeText(value));
}

export function describeMatch(match, channelName) {
  const homeTeam = safeText(match?.home_team || match?.payload?.homeTeam?.name || match?.payload?.homeTeam);
  const awayTeam = safeText(match?.away_team || match?.payload?.awayTeam?.name || match?.payload?.awayTeam);
  const league = safeText(match?.league || match?.payload?.league);
  const channel = safeText(match?.channel || channelName);

  const hasTeams = Boolean(homeTeam && awayTeam);
  const title = hasTeams
    ? `${homeTeam} ضد ${awayTeam} بث مباشر | ${SITE_NAME}`
    : `مشاهدة ${channelName} بث مباشر | ${SITE_NAME}`;

  const description = hasTeams
    ? `شاهد مباراة ${homeTeam} ضد ${awayTeam} بث مباشر${league ? ` ضمن ${league}` : ""}${isKnownChannel(channel) ? ` على ${channel}` : ""} عبر koratv Football مع سيرفرات متعددة وجودات 1080 و720 و360.`
    : `شاهد ${channelName} بث مباشر عبر koratv Football مع مشغل آمن وسيرفرات متعددة وجودات مناسبة لكل سرعة إنترنت.`;

  return {
    title,
    description,
    homeTeam,
    awayTeam,
    league,
    channel,
    startDate: match?.kickoff_time || match?.payload?.scheduledAt || null,
    matchId: match?.match_id || match?.id || ""
  };
}

async function findMatchById(supabase, matchId) {
  const id = safeText(matchId);
  if (!id) return null;

  const byMatchId = await supabase
    .from("matches")
    .select("id,match_id,home_team,away_team,league,kickoff_time,channel,payload,active,updated_at")
    .eq("match_id", id)
    .eq("active", true)
    .maybeSingle();

  if (byMatchId.data) return byMatchId.data;

  const byId = await supabase
    .from("matches")
    .select("id,match_id,home_team,away_team,league,kickoff_time,channel,payload,active,updated_at")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  return byId.data || null;
}

async function findMatchByChannel(supabase, channelName) {
  const channel = safeText(channelName);
  if (!channel) return null;

  const lowerBound = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("matches")
    .select("id,match_id,home_team,away_team,league,kickoff_time,channel,payload,active,updated_at")
    .eq("active", true)
    .ilike("channel", `%${channel}%`)
    .gte("kickoff_time", lowerBound)
    .order("kickoff_time", { ascending: true })
    .limit(1);

  if (error) return null;
  return data?.[0] || null;
}

async function findMatchByOpaqueId(supabase, publicId) {
  if (!isOpaqueId(publicId)) return null;
  const lowerBound = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("matches")
    .select("id,match_id,home_team,away_team,league,kickoff_time,channel,payload,active,updated_at")
    .eq("active", true)
    .gte("kickoff_time", lowerBound)
    .order("kickoff_time", { ascending: true })
    .limit(700);

  if (error) return null;
  return (data || []).find((row) => {
    const fallback = `${safeText(row.home_team)}-${safeText(row.away_team)}-${safeText(row.kickoff_time).slice(0, 10) || "undated"}`;
    return opaqueWatchId(row.match_id || row.id || fallback) === publicId || opaqueWatchId(fallback) === publicId;
  }) || null;
}

async function findChannelByOpaqueId(supabase, publicId) {
  if (!isOpaqueId(publicId)) return null;
  const { data, error } = await supabase
    .from("channels")
    .select("name,active")
    .eq("active", true)
    .limit(1500);

  if (error) return null;
  return (data || []).find((row) => opaqueWatchId(row.name) === publicId) || null;
}

export async function resolveWatchTarget({ routeToken, matchId = "" }) {
  const decodedToken = safeText(decodeURIComponent(routeToken || ""), "koratv");

  try {
    const supabase = getSupabaseAdmin();
    const match = (await findMatchById(supabase, matchId)) || (await findMatchByOpaqueId(supabase, decodedToken));
    if (match) {
      const channelName = safeText(match.channel, decodedToken);
      return { channelName, match };
    }

    const channel = await findChannelByOpaqueId(supabase, decodedToken);
    if (channel?.name) return { channelName: channel.name, match: null };

    const channelMatch = await findMatchByChannel(supabase, decodedToken);
    return { channelName: decodedToken, match: channelMatch };
  } catch {
    return { channelName: decodedToken, match: null };
  }
}

export async function getWatchSeoDetails({ routeToken, channelName, matchId = "" }) {
  const target = await resolveWatchTarget({ routeToken: routeToken || channelName, matchId });
  const seo = describeMatch(target.match, target.channelName);
  return { ...seo, playerChannelName: target.channelName };
}

export async function getEmbedTarget({ routeToken, matchId = "" }) {
  return resolveWatchTarget({ routeToken, matchId });
}

export function publicWatchIdFor({ channelName, matchId = "" }) {
  return opaqueWatchId(matchId || channelName);
}

export function publicEmbedUrlFor({ channelName, matchId = "" }) {
  return embedUrl(channelName, matchId);
}

export function buildWatchJsonLd({ seo, channelName, matchId = "" }) {
  const canonical = watchUrl(channelName, matchId || seo.matchId);
  const eventId = `${canonical}#sports-event`;
  const broadcastId = `${canonical}#broadcast-event`;
  const hasTeams = Boolean(seo.homeTeam && seo.awayTeam);
  const startDate = seo.startDate || new Date().toISOString();

  const graph = [
    {
      "@type": "WebPage",
      "@id": canonical,
      "url": canonical,
      "name": seo.title,
      "description": seo.description,
      "inLanguage": "ar",
      "isPartOf": {
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": CANONICAL_ORIGIN
      },
      "publisher": {
        "@type": "Organization",
        "name": SITE_NAME,
        "url": CANONICAL_ORIGIN,
        "logo": absoluteUrl("/assets/images/logo.png")
      }
    },
    {
      "@type": hasTeams ? "SportsEvent" : "BroadcastEvent",
      "@id": hasTeams ? eventId : broadcastId,
      "name": hasTeams ? `${seo.homeTeam} ضد ${seo.awayTeam}` : `${seo.channel || channelName} بث مباشر`,
      "description": seo.description,
      "startDate": startDate,
      "eventStatus": "https://schema.org/EventScheduled",
      "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
      "location": {
        "@type": "VirtualLocation",
        "url": canonical
      },
      "organizer": {
        "@type": "Organization",
        "name": SITE_NAME,
        "url": CANONICAL_ORIGIN
      }
    }
  ];

  if (hasTeams) {
    graph[1].sport = "Football";
    graph[1].homeTeam = { "@type": "SportsTeam", "name": seo.homeTeam };
    graph[1].awayTeam = { "@type": "SportsTeam", "name": seo.awayTeam };
    graph.push({
      "@type": "BroadcastEvent",
      "@id": broadcastId,
      "name": `${seo.homeTeam} ضد ${seo.awayTeam} بث مباشر`,
      "isLiveBroadcast": true,
      "startDate": startDate,
      "broadcastOfEvent": { "@id": eventId },
      "publishedOn": {
        "@type": "BroadcastService",
        "name": seo.channel || SITE_NAME
      }
    });
  } else {
    graph[1].isLiveBroadcast = true;
    graph[1].publishedOn = {
      "@type": "BroadcastService",
      "name": seo.channel || channelName
    };
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}
