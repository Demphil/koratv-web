import '../src/lib/loadEnv.js';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin.js';
import { pruneMatchData } from './prune-match-data.js';

const table = process.env.SUPABASE_MATCHES_TABLE || 'matches';
const deleted = await pruneMatchData(getSupabaseAdmin(), table);
console.log(JSON.stringify({ event: 'stale_match_cleanup_complete', table, deleted }));
