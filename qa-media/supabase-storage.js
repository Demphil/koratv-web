const { config } = require('./config');
const { getSupabase } = require('./supabase');

async function saveStaging(matchId, payload) {
  try {
    const { error } = await getSupabase()
      .from(config.stagingCollection)
      .upsert({
        match_id: matchId,
        payload,
        environment: 'staging',
        updated_at: new Date().toISOString()
      }, { onConflict: 'match_id' })
      .select();
    if (error) {
      console.error(`[MEDIA QA] Supabase staging upsert failed for ${matchId}:`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw new Error(JSON.stringify(error));
    }
    console.log(`[MEDIA QA] Saved staging payload for ${matchId} to ${config.stagingCollection}`);
  } catch (error) {
    if (!error?.code && error?.message) {
      console.error(`[MEDIA QA] Supabase staging insertion failed for ${matchId}: ${error.message}`);
    }
    throw error;
  }
}

module.exports = { saveStaging };
