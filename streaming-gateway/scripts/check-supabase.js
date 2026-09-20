import { loadConfig } from '../config.js';

const rows = await loadConfig().getMatches();
console.log(`Supabase match feed is available (${rows.length} active matches).`);
