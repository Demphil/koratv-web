import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";

const requiredTables = [
  "channels",
  "stream_access_audit",
  "matches",
  "channel_language_alternatives"
];

async function checkTable(supabase, table) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .limit(1);

  if (error) {
    return {
      table,
      ok: false,
      code: error.code || "UNKNOWN",
      message: error.message
    };
  }

  return {
    table,
    ok: true,
    rowsSeen: data?.length || 0,
    columns: data?.[0] ? Object.keys(data[0]) : []
  };
}

async function main() {
  const supabase = getSupabaseAdmin();
  const results = [];

  for (const table of requiredTables) {
    results.push(await checkTable(supabase, table));
  }

  console.log(JSON.stringify({
    ok: results.every((result) => result.ok),
    tables: results
  }, null, 2));

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
