export const SELECTED_BROADCAST_IDS = Object.freeze([
  'kooora_2026-11-27_بريست_vs_باريس',
  'kooora_2026-11-27_فينيسيا_vs_بولونيا',
  'kooora_2026-11-27_ليفانتي_vs_راسينج_سانتاندير',
  'kooora_2026-11-27_نوتنجهام_فوريست_vs_تشيلسي',
  'kooora_2026-11-28_الاتفاق_vs_الهلال',
  'kooora_2026-11-28_ريال_بيتيس_vs_رايو_فاليكانو',
  'kooora_2026-11-28_كولن_vs_ايلفيرسبيرج',
  'kooora_2026-11-28_هامبورج_vs_بايرن_ميونخ',
  'kooora_2026-11-28_الحزم_vs_النصر',
]);

const selected = new Set(SELECTED_BROADCAST_IDS);
let runtimeSelection;
let lastRefresh = 0;
let pendingRefresh;
const STORAGE_KEY = 'operator_broadcast_selection_v1';
export function validateBroadcastSelection(body) {
  if (body?.version !== 1 || !Number.isSafeInteger(body.revision) || typeof body.enabled !== 'boolean'
    || !Array.isArray(body.matches) || body.matches.length > 8 || new Set(body.matches).size !== body.matches.length
    || body.matches.some(id => typeof id !== 'string' || id.length > 160 || !id.startsWith('kooora_'))) {
    throw Error('Invalid broadcast selection');
  }
  return { version: 1, revision: body.revision, enabled: body.enabled, matches: body.enabled ? [...body.matches] : [] };
}
export async function refreshBroadcastSelection({ fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  if (!force && runtimeSelection && now - lastRefresh < 15000) return runtimeSelection;
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    try {
      const response = await fetchImpl('https://aws-stream.koratv.click/api/broadcast-control?view=selection', {
        cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw Error('Broadcast selection unavailable');
      const next = validateBroadcastSelection(await response.json());
      if (!runtimeSelection || next.revision >= runtimeSelection.revision) runtimeSelection = next;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: now, selection: runtimeSelection })); } catch {}
    } catch {
      if (!runtimeSelection) {
        try {
          const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
          if (stored && now - stored.savedAt >= 0 && now - stored.savedAt < 5 * 60000) runtimeSelection = validateBroadcastSelection(stored.selection);
        } catch {}
      }
      runtimeSelection ||= { version: 1, revision: 0, enabled: false, matches: [] };
    }
    lastRefresh = now;
    return runtimeSelection;
  })().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}
export function isSelectedBroadcast(id) {
  return runtimeSelection ? runtimeSelection.enabled && runtimeSelection.matches.includes(String(id || '')) : selected.has(String(id || ''));
}
