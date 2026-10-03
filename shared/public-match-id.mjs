// Stable public identifiers do not replace the provider/database match identity.
export function publicMatchId(value) {
  let hash = 0xcbf29ce484222325n;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return String(hash).padStart(20, '0');
}

export function resolvePublicMatchId(value, rows) {
  const requested = String(value || '').trim();
  const ids = [...new Set(rows.map(row => String(row.match_id || row.id || '')).filter(Boolean))];
  const matches = ids.filter(id => publicMatchId(id) === requested);
  return matches.length === 1 ? matches[0] : '';
}
