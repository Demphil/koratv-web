const PREFIX_NOISE = new Set(['ar', 'spi', 'ma', 'iptv', 'live', 'tv', 'channel', 'chan', 'stream', 'sports']);
const QUALITY_LABELS = new Set(['hd', 'fhd', 'uhd', '4k', '8k', 'fullhd']);
const VARIANT_LABELS = new Set(['tnt', 'sd', 'max', 'premium', 'terrestrial', 'eng', 'english', 'fr', 'french', 'tr', 'turkish', 'xtra', 'extra', 'connect']);
const REQUIRED_BASE_LABELS = new Set(['plus']);

function tokensFor(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\+/g, ' plus ')
    .replace(/\bdstv\s*now\b/giu, ' dstv ')
    .replace(/\bdstvnow\b/giu, ' dstv ')
    .replace(/\btod\s*tv\b/giu, ' tod ')
    .replace(/\bbein\s+sports?\s+connect\b/giu, ' bein connect ')
    .replace(/\bs\s*\/\s*d\b/giu, ' sd ')
    .replace(/\b(hd|fhd|uhd)(\d{1,2})\b/giu, '$1 $2')
    .replace(/[^a-z0-9\p{L}]+/giu, ' ')
    .toLowerCase()
    .replace(/\bsabc\s+plus\b/g, 'sabc plus')
    .replace(/\bdisney\s+plus\b/g, 'disney plus')
    .replace(/\bsport\b/g, 'sports')
    .replace(/\b0([1-9])\b/g, '$1')
    .replace(/\bbein\s+sports\s+mena\b/g, 'bein sports')
    .replace(/\bsnrt(?:\s+live)?\b/g, 'arryadia tnt')
    .replace(/(?:الرياضيه\s+المغربيه|المغربيه\s+الرياضيه)/gu, ' arryadia ')
    .replace(/\barryadia\s+(?:hd\s*3|3\s*hd|3)\b/giu, 'arryadia tnt')
    .replace(/\b(?:arr?y?adia|arriadia)\b/giu, 'arryadia');
  return normalized.split(/\s+/).filter(Boolean);
}

function editSimilarity(left, right) {
  if (left === right) return 1;
  if (Math.min(left.length, right.length) < 4) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function variantOf(tokens) {
  return tokens.filter((token) => /^\d{1,2}$/.test(token) || VARIANT_LABELS.has(token)).sort().join(':');
}

function baseTokens(tokens) {
  return tokens.filter((token) =>
    !PREFIX_NOISE.has(token) &&
    !QUALITY_LABELS.has(token) &&
    !VARIANT_LABELS.has(token) &&
    !/^\d{1,2}$/.test(token)
  );
}

function describeName(name) {
  const tokens = tokensFor(name);
  return { name, base: baseTokens(tokens), variant: variantOf(tokens), explicit: explicitVariant(name) };
}

function scoreName(request, candidate) {
  const requestBase = request.base;
  const candidateBase = candidate.base;
  if (!requestBase.length || !candidateBase.length) return 0;
  for (const token of REQUIRED_BASE_LABELS) {
    if (requestBase.includes(token) && !candidateBase.includes(token)) return 0;
  }

  const requestVariant = request.variant;
  const candidateVariant = candidate.variant;
  if (requestVariant && candidateVariant && requestVariant !== candidateVariant) return 0;
  if (requestVariant && !candidateVariant) return 0;

  const wordScores = candidateBase.map((wanted) => Math.max(...requestBase.map((seen) => editSimilarity(wanted, seen))));
  if (wordScores.some((score) => score < 0.78)) return 0;
  const average = wordScores.reduce((sum, score) => sum + score, 0) / wordScores.length;
  return average - (!requestVariant && candidateVariant ? 0.08 : 0);
}

function explicitVariant(value) {
  const text = String(value || '').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '');
  if (/\btnt\b/i.test(text)) return 'tnt';
  if (/\bs\s*\/\s*d\b|\bsd\b/i.test(text)) return 'sd';
  if (/\b(?:hd\s*3|3\s*hd|3)\b/i.test(text)) return 'hd3';
  return '';
}

export function createChannelNameMatcher(candidates) {
  const rows = (candidates || []).filter(name => typeof name === 'string' && name.trim()).map(describeName);
  const exactNames = new Map();
  for (const row of rows) if (!exactNames.has(row.name.toLowerCase())) exactNames.set(row.name.toLowerCase(), row.name);
  return (requested) => {
  if (/^SNRT(?:\s+Live)?$/i.test(String(requested || '').trim())) requested = 'Arryadia TNT';
  const exact = exactNames.get(String(requested || '').toLowerCase());
  if (exact) return exact;
  const request = describeName(requested);
  let ranked = rows
    .map((candidate) => ({ name: candidate.name, explicit: candidate.explicit, score: scoreName(request, candidate) }))
    .filter(({ score }) => score >= 0.78)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  const requestedVariant = request.explicit;
  if (requestedVariant) {
    const exactVariant = ranked.filter(({ explicit }) => explicit === requestedVariant);
    if (exactVariant.length) ranked = exactVariant;
  }
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.08) return null;
  return ranked[0].name;
  };
}

export function findChannelNameMatch(requested, candidates) {
  return createChannelNameMatcher(candidates)(requested);
}
