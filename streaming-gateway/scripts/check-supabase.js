import { loadConfig } from '../config.js';
import { createClient } from '@supabase/supabase-js';

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const { error } = await client.from('channels').select('quality_variants').limit(1);
if (error) {
  throw new Error(`Channel quality schema check failed (${error.code}). Apply secure-streaming/supabase/migrations/005_channel_quality_variants.sql.`);
}

const rows = await loadConfig().getMatches();
console.log(`Supabase match feed is available (${rows.length} active matches).`);
