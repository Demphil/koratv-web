import { findChannelNameMatch } from './channel-name-match.mjs';

export function parseAttributes(line) {
  const attrs = {};
  line.replace(/([\w-]+)="([^"]*)"/g, (_, key, value) => {
    attrs[key.toLowerCase()] = value.trim();
    return '';
  });
  return attrs;
}

export function cleanName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/[|*]+/g, ' ')
    .trim();
}

export function normalizeName(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\bhd\s*([1-9])\b/g, '$1')
    .replace(/\bmax\s*([1-9])\b/g, 'max $1')
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\b(?:[48]\s*k|(?:720|1080|2160)p|uhd|fullhd)\b/g, ' ')
    .replace(/([\p{L}])([0-9])/gu, '$1 $2')
    .replace(/([0-9])([\p{L}])/gu, '$1 $2')
    .replace(/\bar\b/g, ' ')
    .replace(/\bsp\b/g, ' ')
    .replace(/\buae\b/g, ' ')
    .replace(/\bksa\b/g, ' ')
    .replace(/\begy\b/g, ' ')
    .replace(/\bma\b/g, ' ')
    .replace(/\bsnrt\b/g, 'arryadia')
    .replace(/\bhevc\b/g, ' ')
    .replace(/\bfhd\b/g, ' ')
    .replace(/\bhd\b/g, '')
    .replace(/\bsd\b/g, '')
    .replace(/\b0([1-9])\b/g, '$1')
    .replace(/\bsports\b/g, 'sport')
    .replace(/\bextra\b/g, 'xtra')
    .replace(/\bontime\b/g, 'on time')
    .replace(/\bal\s+kass\b/g, 'alkass')
    .replace(/\bbein\b/g, 'bein')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:dz\s+)?en\s*tv(?:\s+algerie)?\b/g, 'entv')
    .trim();
}

function entrySearchText(entry) {
  return normalizeName(`${entry.name} ${entry.group || ''}`);
}

export const CHANNEL_MATCH_POLICY_VERSION = 2;

export function beinRegion(value) {
  const text = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(?:fr|fra|france|french|francais)\b/.test(text)) return 'fr';
  if (/\b(?:eng|english|en|uk|gb)\b/.test(text)) return 'en';
  if (/\b(?:tr|tur|turkey|turkish)\b/.test(text)) return 'tr';
  if (/\b(?:us|usa|ca|canada|au|australia|es|spain|id|indonesia|th|thailand|hk|hong kong)\b/.test(text)) return 'other';
  if (/\b(?:ar|arab|arabic|mena|qa|qatar|sa|ksa)\b|عربي|العربي/.test(text)) return 'ar';
  return '';
}

export function parseM3uText(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attrs = parseAttributes(line);
      const commaName = line.includes(',') ? line.slice(line.lastIndexOf(',') + 1) : '';
      const rawName = attrs['tvg-name'] || commaName;
      current = {
        rawName,
        name: cleanName(rawName),
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || ''
      };
      continue;
    }
    if (!line.startsWith('#') && current) {
      const entry = { ...current, url: line };
      entry.search = entrySearchText(entry);
      entries.push(entry);
      current = null;
    }
  }
  return entries;
}

function channelRule(name) {
  const normalized = normalizeName(name);
  const number = normalized.match(/\b(\d{1,2})\b/)?.[1];
  const maxNumber = normalized.match(/\bmax\s*(\d{1,2})\b/)?.[1] || (normalized.includes('max') ? number : '');

  if (normalized.includes('bein') && normalized.includes('max') && maxNumber) {
    return { required: ['bein', 'sport', 'max', maxNumber], preferred: ['hd', 'arab'] };
  }
  if (normalized.includes('bein') && normalized.includes('xtra')) {
    return { required: ['bein', 'sport', 'xtra', ...(number ? [number] : [])], preferred: ['hd'] };
  }
  if (normalized.includes('bein') && normalized.includes('premium') && number) {
    return { required: ['bein', 'sport', 'premium', number], preferred: ['hd'] };
  }
  if (normalized.includes('bein') && normalized.includes('connect')) {
    return { required: ['bein', 'connect'], preferred: ['hd'] };
  }
  if (normalized.includes('bein') && number) {
    return { required: ['bein', 'sport', number], preferred: ['hd'] };
  }
  if (normalized.includes('bein')) {
    return { required: ['bein', 'sport'], preferred: ['global', 'hd'] };
  }
  if (normalized.includes('arryadia') || normalized.includes('الرياضيه') || normalized.includes('المغربيه')) {
    if (number) return { required: ['arryadia', number], preferred: ['hd'] };
    const requestedVariant = /\btnt\b/i.test(name)
      ? 'tnt'
      : /\bs\s*\/\s*d\b|\bsd\b/i.test(name)
        ? 'sd'
        : '';
    return {
      required: ['arryadia'],
      preferred: requestedVariant ? [requestedVariant, 'hd'] : ['tnt', 'hd'],
      channelVariant: requestedVariant
    };
  }
  if (normalized.includes('on sport plus') || normalized.includes('اون سبورت بلس') || normalized.includes('اون سبورت بلاس') || normalized.includes('on time sport 2') || normalized.includes('اون سبورت 2')) {
    return { required: ['on', 'sport', 'plus'], preferred: ['hd'] };
  }
  if (normalized.includes('on sport') || normalized.includes('on time') || normalized.includes('اون سبورت')) {
    return { required: ['on', 'sport'], preferred: ['hd'] };
  }
  if (normalized.includes('ad sport') || normalized.includes('abu dhabi sport') || normalized.includes('ابو ظبي') || normalized.includes('ابوظبي')) {
    const adNumber = normalized.match(/\b([1-3])\b/)?.[1] || '1';
    const required = normalized.includes('abu dhabi')
      ? ['abu', 'dhabi', 'sport', adNumber]
      : ['ad', 'sport', adNumber];
    return { required, preferred: ['fhd', 'hd'] };
  }
  if (normalized.includes('oman sport')) {
    return { required: ['oman', 'sport'], preferred: ['hd'] };
  }
  if (normalized.includes('kuwait sport')) {
    const kuwaitNumber = normalized.match(/\b([1-2])\b/)?.[1] || '';
    return { required: ['kuwait', 'sport', ...(kuwaitNumber ? [kuwaitNumber] : [])], preferred: ['hd'] };
  }
  if (normalized.includes('ثمانيه') || normalized.includes('thmanyah')) {
    const thNumber = normalized.match(/\b([123])\b/)?.[1] || '1';
    return { required: ['thmanyah', thNumber], preferred: ['fhd', 'hd'] };
  }
  if (normalized.includes('mbc action')) {
    return { required: ['mbc', 'action'], preferred: ['fhd', 'hd'] };
  }
  if (normalized.includes('starzplay') || normalized.includes('starz')) {
    return { required: ['starzplay'], preferred: ['sport', 'hd'] };
  }
  if (normalized.includes('shahid') || normalized.includes('شاهد')) {
    return { required: ['shahid', 'vip'], preferred: ['live', 'hd'] };
  }
  if (normalized.includes('alkass') || normalized.includes('الكاس') || normalized.includes('الكأس')) {
    const alkassNumber = normalized.match(/\b([1-8])\b/)?.[1] || '1';
    return { required: ['alkass', alkassNumber], preferred: ['hd'] };
  }
  if (normalized.includes('ssc') || normalized.includes('ksa sport')) {
    const ksaNumber = normalized.match(/\b([1-4])\b/)?.[1] || '1';
    return { required: ['ksa', 'sport', ksaNumber], preferred: ['hd'] };
  }
  return null;
}

function scoreEntry(entry, rule, requestedName = '') {
  const text = entry.search || entrySearchText(entry);
  const raw = `${entry.rawName || entry.name} ${entry.group || ''}`.toLowerCase();
  const words = new Set(text.split(/\s+/));
  if (!rule.required.every((token) => words.has(token))) return -1;
  if (rule.required.includes('bein')) {
    const nameWords = new Set(normalizeName(entry.name).split(/\s+/));
    const number = rule.required.find((token) => /^\d+$/.test(token));
    const sourceNumber = normalizeName(entry.name).match(/\b(\d{1,2})\b/)?.[1];
    if (number && sourceNumber !== number) return -1;
    for (const variant of ['max', 'xtra', 'premium', 'connect']) {
      if (nameWords.has(variant) !== rule.required.includes(variant)) return -1;
    }
    const requestedRegion = beinRegion(requestedName) || 'ar';
    const sourceRegion = beinRegion(raw);
    if (sourceRegion !== requestedRegion) return -1;
  }
  if (rule.required.includes('arryadia')) {
    const number = rule.required.find(token => /^\d+$/.test(token));
    if (number && !new Set(normalizeName(entry.name).split(/\s+/)).has(number)) return -1;
  }
  if (rule.required.includes('on') && rule.required.includes('sport')) {
    if (words.has('plus') !== rule.required.includes('plus')) return -1;
    if (/\bhevc\b/i.test(raw)) return -1;
  }
  if (rule.channelVariant === 'tnt' && !/\btnt\b/i.test(raw)) return -1;
  if (rule.channelVariant === 'sd' && !/(?:\bs\s*\/\s*d\b|\bsd\b)/i.test(raw)) return -1;
  let score = rule.required.length * 10;
  if (rule.required.includes('bein') && beinRegion(raw) === 'ar') score += 100;
  for (const token of rule.preferred || []) {
    if (text.includes(token)) score += 3;
  }
  if (entry.group && /AR \| BEIN SPORTS/i.test(entry.group)) score += 5;
  if (entry.group && /AR \| ARAB SPORT/i.test(entry.group)) score += 3;
  if (!raw.includes('[bk')) score += 10;
  if (text.includes('bk') || raw.includes('[bk')) score -= 8;
  if (text.includes('wafcon')) score -= 8;
  if (text.includes('ppv')) score -= 6;
  if (text.includes('event')) score -= 2;
  if (text.includes('sd')) score -= 2;
  return score;
}

function findByRule(name, entries) {
  const rule = channelRule(name);
  if (!rule) return null;
  let best = null;
  let bestScore = -1;
  for (const entry of entries) {
    const score = scoreEntry(entry, rule, name);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

function findByRuleCandidates(name, entries, limit = 8) {
  const rule = channelRule(name);
  if (!rule) return [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, rule, name) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

function pushUniqueEntry(target, entry) {
  if (!entry || target.some((item) => item.url === entry.url)) return;
  target.push(entry);
}

export function isProviderChannelCompatible(name, entry) {
  const rule = channelRule(name);
  if (rule && (rule.required.includes('bein') || rule.required.includes('arryadia')
    || (rule.required.includes('on') && rule.required.includes('sport')))) return scoreEntry(entry, rule, name) >= 0;
  return true;
}

export function isCatalogChannelSourceVerified(name, row, providerId) {
  const sourceName = row?.sourceNames?.[providerId] || '';
  const rule = channelRule(name);
  if (rule && (rule.required.includes('arryadia') || (rule.required.includes('on') && rule.required.includes('sport')))) {
    return Boolean(sourceName) && isProviderChannelCompatible(name, { name: sourceName, rawName: sourceName,
      group: row.sourceGroups?.[providerId] || '' });
  }
  if (!/\bbein\b/i.test(`${name} ${sourceName}`)) return true;
  // Old mappings lost the provider category, so their region cannot be trusted.
  if (row?.sourcePolicyVersions?.[providerId] !== CHANNEL_MATCH_POLICY_VERSION) return false;
  return Boolean(sourceName) && isProviderChannelCompatible(name, {
    name: sourceName, rawName: sourceName, group: row.sourceGroups?.[providerId] || ''
  });
}

export function matchChannels(streamNames, m3uEntries, options = {}) {
  const candidatesPerChannel = Number(options.candidatesPerChannel || 1);
  const exact = new Map();
  const normalized = new Map();
  for (const entry of m3uEntries) {
    if (!exact.has(entry.name)) exact.set(entry.name, []);
    exact.get(entry.name).push(entry);
    const norm = normalizeName(entry.name);
    if (norm) {
      if (!normalized.has(norm)) normalized.set(norm, []);
      normalized.get(norm).push(entry);
    }
  }

  return streamNames
    .map((name) => {
      const candidates = [];
      for (const entry of exact.get(name) || []) pushUniqueEntry(candidates, entry);
      for (const entry of normalized.get(normalizeName(name)) || []) pushUniqueEntry(candidates, entry);
      const matchedProviderName = findChannelNameMatch(name, m3uEntries.map((entry) => entry.name));
      if (matchedProviderName) {
        for (const entry of exact.get(matchedProviderName) || []) pushUniqueEntry(candidates, entry);
      }
      for (const entry of findByRuleCandidates(name, m3uEntries, Math.max(candidatesPerChannel, 8))) {
        pushUniqueEntry(candidates, entry);
      }

      const rule = channelRule(name);
      if (rule && (rule.required.includes('bein') || rule.required.includes('arryadia')
        || (rule.required.includes('on') && rule.required.includes('sport')))) {
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
          if (scoreEntry(candidates[index], rule, name) < 0) candidates.splice(index, 1);
        }
        candidates.sort((a, b) => scoreEntry(b, rule, name) - scoreEntry(a, rule, name));
      }
      const entry = candidates[0] || findByRule(name, m3uEntries);
      if (!entry) return null;

      const item = { name, original_url: entry.url, active: true, source_name: entry.name };
      if (candidatesPerChannel > 1) {
        item.candidates = candidates.slice(0, candidatesPerChannel).map((candidate) => ({
          original_url: candidate.url,
          source_name: candidate.name,
          group: candidate.group || ''
        }));
      }
      return item;
    })
    .filter(Boolean);
}
