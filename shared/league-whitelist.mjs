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
  /كاس اسيا|كأس اسيا|كاس امم اسيا|كأس امم اسيا|afc asian cup|asian cup/i,
  /دوري ابطال اسيا|دوري ابطال اسيا للنخبه|كاس الاتحاد الاسيوي|كأس الاتحاد الاسيوي|afc champions league|afc champions league elite|afc champions league two|afc cup|afc challenge league/i,
  /بطوله اسيا تحت \d+|كاس اسيا تحت \d+|afc u(?:17|20|23)|afc asian cup u(?:17|20|23)/i,
  /بطوله غرب اسيا|كاس غرب اسيا|waff championship|west asian championship/i,
  /بطوله شرق اسيا|كاس شرق اسيا|eaff championship|east asian championship/i,
  /بطوله جنوب اسيا|كاس جنوب اسيا|saff championship|south asian championship/i,
  /بطوله وسط اسيا|كاس وسط اسيا|cafa nations cup|central asian/i,
  /مباراه وديه|مباريات وديه|وديه دوليه|ودية دولية|international friendl(?:y|ies)|friendly international|friendlies/i,
  /كاس العالم|تصفيات كاس العالم|fifa world cup|world cup qualification|world cup qualifier/i,
  /كوبا امريكا|copa america/i,
  /الكاس الذهبيه|كأس الكونكاكاف الذهبية|concacaf gold cup|concacaf nations league/i,
  /كاس امم اوقيانوسيا|ofc nations cup/i,
  /كاس العرب|arab cup|fifa arab cup/i,
  /كاس العالم تحت \d+|fifa u(?:17|20) world cup/i,
  /كره القدم الاولمبيه|olympic football|olympics football/i,
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

const ALLOWED_TEAM_PATTERNS = [
  /inter\s*miami|inter\s*miami\s*cf|انتر\s*ميامي|إنتر\s*ميامي/i,
  /botafogo|botafogo\s*fr|بوتافوغو|بوتافوجو|بوتافوقو/i,
];

export function normalizeTeamName(value) {
  return normalizeLeagueName(value);
}

export function isAllowedTeam(value) {
  const normalized = normalizeTeamName(value);
  return Boolean(normalized && ALLOWED_TEAM_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export function isAllowedMatch({ league = '', homeTeam = '', awayTeam = '' } = {}) {
  return isAllowedLeague(league) || isAllowedTeam(homeTeam) || isAllowedTeam(awayTeam);
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
  'كأس آسيا', 'دوري أبطال آسيا للنخبة', 'دوري أبطال آسيا 2',
  'كأس الاتحاد الآسيوي', 'بطولات آسيا للفئات السنية',
  'بطولات غرب/شرق/جنوب/وسط آسيا', 'المباريات الودية الدولية',
  'كأس العالم وتصفياته', 'كوبا أمريكا', 'الكأس الذهبية للكونكاكاف',
  'دوري أمم الكونكاكاف', 'كأس أمم أوقيانوسيا', 'كأس العرب',
  'كأس العالم تحت 17/20 سنة', 'كرة القدم الأولمبية',
]);

export const ALLOWED_TEAM_LABELS = Object.freeze([
  'Inter Miami CF',
  'Botafogo',
]);
