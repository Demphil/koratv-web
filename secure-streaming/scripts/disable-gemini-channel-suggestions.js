import "../src/lib/loadEnv.js";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: alternatives, error: alternativesReadError } = await supabase
    .from("channel_language_alternatives")
    .select("id,match_id,language,base_channel_name,channel_name,active")
    .eq("source", "gemini")
    .eq("active", true);

  if (alternativesReadError) throw alternativesReadError;

  const { data: matches, error: matchesReadError } = await supabase
    .from("matches")
    .select("id,match_id,channel,payload")
    .eq("payload->>channelResolvedBy", "gemini");

  if (matchesReadError) throw matchesReadError;

  console.log(`Gemini active alternatives to disable: ${alternatives?.length || 0}`);
  console.log(`Matches with Gemini-applied channel to clear: ${matches?.length || 0}`);

  if (dryRun) {
    console.log("[dry-run] No database rows changed.");
    return;
  }

  if (alternatives?.length) {
    const { error } = await supabase
      .from("channel_language_alternatives")
      .update({
        active: false,
        notes: "Disabled automatically because Gemini suggestions require manual verification against an official schedule.",
        updated_at: now
      })
      .eq("source", "gemini")
      .eq("active", true);

    if (error) throw error;
  }

  for (const row of matches || []) {
    const payload = {
      ...(row.payload || {}),
      channelResolvedBy: "manual_review_required",
      channelClearedAt: now
    };

    const { error } = await supabase
      .from("matches")
      .update({
        channel: null,
        payload,
        updated_at: now
      })
      .eq("id", row.id);

    if (error) throw error;
  }

  console.log("Gemini-generated active channel suggestions were disabled.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
