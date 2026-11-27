export const SELECTED_BROADCAST_IDS = Object.freeze([
  'kooora_2026-11-27_بريست_vs_باريس',
  'kooora_2026-11-27_فينيسيا_vs_بولونيا',
  'kooora_2026-11-27_ليفانتي_vs_راسينج_سانتاندير',
  'kooora_2026-11-27_نوتنجهام_فوريست_vs_تشيلسي',
]);

const selected = new Set(SELECTED_BROADCAST_IDS);
export function isSelectedBroadcast(id) {
  return selected.has(String(id || ''));
}
