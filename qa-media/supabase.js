require('dotenv').config({ path: require('node:path').resolve(process.cwd(), '.env') });
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) {
    console.error('[MEDIA QA] Supabase is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

module.exports = { getSupabase };
