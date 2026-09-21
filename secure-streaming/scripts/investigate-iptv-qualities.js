import "../src/lib/loadEnv.js";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { env, matchChannels, parseM3uText } from "./import-m3u.js";

function normalizeProviderHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `http://${raw.replace(/^\/+|\/+$/g, "")}`;
}

function providerUrl(host) {
  const username = env("IPTV_PROVIDER_USERNAME") || env("IPTV_USERNAME") || env("XTREAM_USERNAME");
  const password = env("IPTV_PROVIDER_PASSWORD") || env("IPTV_PASSWORD") || env("XTREAM_PASSWORD");
  const base = normalizeProviderHost(host);
  if (!base || !username || !password) return "";
  const url = new URL("/get.php", base);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  url.searchParams.set("type", env("IPTV_PROVIDER_TYPE", "m3u_plus"));
  url.searchParams.set("output", env("IPTV_PROVIDER_OUTPUT", "m3u8"));
  return url.href;
}

function providerUrls() {
  return [
    env("IPTV_PROVIDER_URL"),
    providerUrl(env("IPTV_PROVIDER_HOST")),
    providerUrl(env("IPTV_PROVIDER_BACKUP_HOST")),
    providerUrl(env("IPTV_SAMSUNG_LG_DNS"))
  ].filter(Boolean);
}

function parseStreamInf(line) {
  const attrs = {};
  line.replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi, (_, key, value) => {
    attrs[key.toLowerCase()] = String(value || "").replace(/^"|"$/g, "");
    return "";
  });
  return attrs;
}

function qualityFromResolution(resolution = "") {
  const height = Number(String(resolution).match(/x(\d+)/i)?.[1]);
  if (!Number.isFinite(height)) return "";
  if (height >= 1000) return "1080p";
  if (height >= 700) return "720p";
  if (height >= 470) return "480p";
  if (height >= 350) return "360p";
  return `${height}p`;
}

export function parseMasterPlaylistVariants(text, sourceUrl) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const attrs = parseStreamInf(line);
    const uri = lines[index + 1] && !lines[index + 1].startsWith("#") ? lines[index + 1] : "";
    if (!uri) continue;
    const absoluteUrl = new URL(uri, sourceUrl).href;
    variants.push({
      label: qualityFromResolution(attrs.resolution) || attrs.name || attrs.bandwidth || "auto",
      resolution: attrs.resolution || "",
      bandwidth: Number(attrs.bandwidth || 0) || null,
      url: absoluteUrl
    });
  }
  return variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
}

async function fetchText(url, timeoutMs = 90000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
      "user-agent": process.env.IPTV_UPSTREAM_USER_AGENT || "VLC/3.0.20 LibVLC/3.0.20"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchProviderPlaylist() {
  const errors = [];
  for (const url of providerUrls()) {
    try {
      return await fetchText(url);
    } catch (error) {
      errors.push(new URL(url).host);
    }
  }
  throw new Error(`No IPTV provider playlist could be loaded (${errors.join(", ")})`);
}

async function readActiveChannelNames() {
  const supabaseUrl = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase
    .from("channels")
    .select("name,active")
    .eq("active", true)
    .limit(500);
  if (error) throw error;
  return (data || []).map((channel) => channel.name).filter(Boolean);
}

export async function investigateIptvQualities() {
  const limit = Number(process.env.IPTV_QUALITY_INVESTIGATION_LIMIT || 20);
  const playlistText = await fetchProviderPlaylist();
  const providerEntries = parseM3uText(playlistText);
  const channelNames = await readActiveChannelNames();
  const matched = matchChannels(channelNames, providerEntries, { candidatesPerChannel: 1 }).slice(0, limit);

  let masterPlaylists = 0;
  let singlePlaylists = 0;
  const examples = [];

  for (const item of matched) {
    try {
      const text = await fetchText(item.original_url, 12000);
      const variants = parseMasterPlaylistVariants(text, item.original_url);
      if (variants.length) {
        masterPlaylists += 1;
        examples.push({
          channel: item.name,
          variants: variants.map(({ label, resolution, bandwidth }) => ({ label, resolution, bandwidth })).slice(0, 6)
        });
      } else {
        singlePlaylists += 1;
      }
    } catch {
      singlePlaylists += 1;
    }
  }

  const result = {
    checked: matched.length,
    providerEntries: providerEntries.length,
    masterPlaylists,
    singlePlaylists,
    examples
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  investigateIptvQualities().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
