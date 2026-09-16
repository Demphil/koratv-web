import { getSupabaseAdmin } from "./supabaseAdmin";
import fs from "node:fs";
import path from "node:path";

function getLocalChannel(name) {
  const localFile = process.env.LOCAL_CHANNELS_JSON;
  if (!localFile) return null;
  const filePath = path.join(process.cwd(), "runtime", path.basename(localFile));
  const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return items.find((item) => item.active && item.name === name) || null;
}

function getLocalAlternatives(name) {
  const localFile = process.env.LOCAL_CHANNEL_ALTERNATIVES_JSON;
  if (!localFile) return [];
  try {
    const filePath = path.join(process.cwd(), "runtime", path.basename(localFile));
    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return items.filter((item) => item.active !== false && item.base_channel_name === name);
  } catch {
    return [];
  }
}

export async function getActiveChannelByName(name) {
  const local = getLocalChannel(decodeURIComponent(name));
  if (local) return local;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("channels")
    .select("id,name,original_url,active")
    .eq("name", decodeURIComponent(name))
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getChannelLanguageAlternatives(name, matchId = "") {
  const decodedName = decodeURIComponent(name);
  const localAlternatives = getLocalAlternatives(decodedName);
  if (localAlternatives.length) return localAlternatives;

  try {
    const supabase = getSupabaseAdmin();
    if (matchId) {
      const { data, error } = await supabase
        .from("channel_language_alternatives")
        .select("language,channel_name,active")
        .eq("match_id", matchId)
        .eq("active", true);

      if (error) throw error;
      if (data?.length) return data;
    }

    const { data, error } = await supabase
      .from("channel_language_alternatives")
      .select("language,channel_name,active")
      .eq("base_channel_name", decodedName)
      .eq("active", true);

    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

export async function auditStreamAccess({ channel, ipHash, userAgent, event }) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("stream_access_audit").insert({
      channel_id: channel?.id || null,
      channel_name: channel?.name || "unknown",
      ip_hash: ipHash || null,
      user_agent: userAgent || null,
      event
    });
  } catch {
    // Audit logging must never break playback.
  }
}
