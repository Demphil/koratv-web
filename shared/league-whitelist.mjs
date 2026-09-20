const ALLOWED_LEAGUE_PATTERNS = [
  /دوري ابطال اوروبا|uefa champions league|champions league/i,
  /الدوري الانجليزي الممتاز|english premier league|premier league/i,
  /الدوري الاسباني(?!.*درجه)|la ?liga|spanish primera/i,
  /الدوري الايطالي(?!.*درجه)|serie a(?:\s|$)/i,
  /الدوري الالماني(?!.*درجه)|bundesliga(?:\s|$)/i,
  /الدوري الفرنسي(?!.*درجه)|ligue 1(?:\s|$)/i,
  /الدوري الاوروبي|uefa europa league|europa league/i,
  /دوري المؤتمر الاوروبي|uefa conference league|conference league/i,
  /كاس السوبر الاوروبي|uefa super cup|european super cup/i,
  /بطوله امم اوروبا|uefa euro|european championship/i,
  /دوري الامم الاوروبيه|uefa nations league|nations league/i,
  /دوري ابطال افريقيا|caf champions league/i,
  /كاس الكونف(?:ي?دراليه|دراليه) الافريقيه|caf confederation cup/i,
  /كاس السوبر الافريقي|caf super cup/i,
  /كاس امم افريقيا|africa cup of nations|afcon/i,
  /بطوله امم افريقيا للمحليين|african nations championship|chan/i,
  /الدوري المصري الممتاز|egyptian premier league/i,
  /البطوله الوطنيه الاحترافيه المغربيه|البطوله الاحترافيه|الدوري المغربي الممتاز|botola pro/i,
  /الرابطه (?:التونسيه )?المحترفه الاولي(?: التونسيه)?|tunisian ligue 1/i,
  /الرابطه (?:الجزائريه )?المحترفه الاولي(?: الجزائريه)?|algerian ligue 1/i,
  /دوري روشن السعودي|saudi pro league|roshn saudi league/i,
];

export function normalizeLeagueName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAllowedLeague(value) {
  const normalized = normalizeLeagueName(value);
  return Boolean(normalized && ALLOWED_LEAGUE_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export const ALLOWED_LEAGUE_LABELS = Object.freeze([
  'دوري أبطال أوروبا', 'الدوري الإنجليزي الممتاز', 'الدوري الإسباني',
  'الدوري الإيطالي', 'الدوري الألماني', 'الدوري الفرنسي', 'الدوري الأوروبي',
  'دوري المؤتمر الأوروبي', 'كأس السوبر الأوروبي', 'بطولة أمم أوروبا',
  'دوري الأمم الأوروبية', 'دوري أبطال أفريقيا', 'كأس الكونفيدرالية الأفريقية',
  'كأس السوبر الأفريقي', 'كأس أمم أفريقيا', 'بطولة أمم أفريقيا للمحليين',
  'الدوري المصري الممتاز', 'البطولة الوطنية الاحترافية المغربية',
  'الرابطة المحترفة الأولى التونسية', 'الرابطة المحترفة الأولى الجزائرية',
  'دوري روشن السعودي',
]);
