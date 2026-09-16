// The anon key is safe to expose in frontend code for read-only access when Supabase RLS is enabled.
// Replace the placeholder with the project's public anon key; never use the service-role key here.
window.__SUPABASE_CONFIG__ = {
  url: window.SUPABASE_PUBLIC_URL || 'https://vzgldruuinbwslrfwjkb.supabase.co',
  anonKey: window.SUPABASE_ANON_KEY || 'sb_publishable_UWDsCT0XpmEVvoy7CaMFNg_kN64Phlo'
};
