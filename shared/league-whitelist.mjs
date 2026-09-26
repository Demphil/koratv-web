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
  /الدوري المغربي الممتاز|الدوري المغربي|البطوله الوطنيه الاحترافيه المغربيه|البطولة الوطنية الاحترافية المغربية|botola(?:\s*pro)?|moroccan botola|morocco botola/i,
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
  /دوري روشن السعودي|saudi pro league|roshn saudi league/i,
];

const WOMEN_COMPETITION_PATTERNS = [
  /دوري ابطال اوروبا.*سيدات|سيدات.*دوري ابطال اوروبا|uefa women'?s champions league|women'?s champions league/i,
  /بطوله امم اوروبا.*سيدات|سيدات.*بطوله امم اوروبا|uefa women'?s euro|women'?s euro/i,
  /دوري الامم الاوروبيه.*سيدات|سيدات.*دوري الامم الاوروبيه|uefa women'?s nations league/i,
];

const WOMEN_MARKERS = /سيدات|نسائي|نساء|women|women'?s|feminine|femmes/i;

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

export function normalizeTeamName(value) {
  return normalizeLeagueName(value)
    .replace(/سان دي(?:ي)?[غج]و/gi, 'سان دييغو')
    .replace(/\bsan diego\b/gi, 'san diego')
    .trim();
}

function isWomenCompetition(value) {
  const normalized = normalizeLeagueName(value);
  return Boolean(normalized && WOMEN_COMPETITION_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function isWomenLeague(value) {
  const normalized = normalizeLeagueName(value);
  return Boolean(normalized && WOMEN_MARKERS.test(normalized));
}

export function isAllowedLeague(value) {
  const normalized = normalizeLeagueName(value);
  if (isWomenLeague(normalized)) return isWomenCompetition(normalized);
  return Boolean(normalized && ALLOWED_LEAGUE_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function normalizeCountryName(value) {
  return normalizeLeagueName(value).toLocaleLowerCase('en');
}

function isAllowedApiFootballLeague(value, country = '') {
  const normalized = normalizeLeagueName(value).toLocaleLowerCase('en');
  const normalizedCountry = normalizeCountryName(country);
  if (!normalizedCountry) return isAllowedLeague(value);
  if (/^premier league$/.test(normalized)) return /england/.test(normalizedCountry);
  if (/^serie a$/.test(normalized)) return /italy/.test(normalizedCountry);
  if (/^bundesliga$/.test(normalized)) return /germany/.test(normalizedCountry);
  if (/^ligue 1$/.test(normalized)) return /france/.test(normalizedCountry);
  if (/^la liga$/.test(normalized)) return /spain/.test(normalizedCountry);
  if (/^national(?:\s*1)?$/.test(normalized)) return /france/.test(normalizedCountry);
  if (/botola|البطوله الوطنيه الاحترافيه المغربيه|الدوري المغربي/.test(normalized)) return /morocco|المغرب/.test(normalizedCountry);
  if (/saudi pro league|pro league|roshn/.test(normalized)) return /saudi/.test(normalizedCountry);
  return isAllowedLeague(value);
}

const ALLOWED_TEAM_PATTERNS = [
  /inter\s*miami|inter\s*miami\s*cf|انتر\s*ميامي|إنتر\s*ميامي/i,
  /botafogo|botafogo\s*fr|بوتافوغو|بوتافوجو|بوتافوقو/i,
];

const NATIONAL_TEAM_EXCEPTIONS = [
  /^(?:منتخب\s*)?المغرب(?:\s*للسيدات)?$|^morocco(?:\s*women)?$|^maroc(?:\s*femmes)?$/i,
  /^(?:منتخب\s*)?الجزا[ئي]ر(?:\s*للسيدات)?$|^algeria(?:\s*women)?$|^algerie(?:\s*femmes)?$|^algérie(?:\s*femmes)?$/i,
];

export function isAllowedTeam(value) {
  const normalized = normalizeTeamName(value);
  return Boolean(normalized && ALLOWED_TEAM_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export function isAllowedNationalTeamException(value) {
  const normalized = normalizeTeamName(value);
  return Boolean(normalized && NATIONAL_TEAM_EXCEPTIONS.some((pattern) => pattern.test(normalized)));
}

export function isAllowedMatch({ league = '', country = '', leagueCountry = '', homeTeam = '', awayTeam = '' } = {}) {
  return isAllowedApiFootballLeague(league, country || leagueCountry)
    || isAllowedTeam(homeTeam)
    || isAllowedTeam(awayTeam)
    || isAllowedNationalTeamException(homeTeam)
    || isAllowedNationalTeamException(awayTeam);
}

export const ALLOWED_LEAGUE_LABELS = Object.freeze([
  'دوري أبطال أوروبا', 'الدوري الإنجليزي الممتاز', 'الدوري الإسباني',
  'الدوري الإيطالي', 'الدوري الألماني', 'الدوري الفرنسي', 'الدوري الأوروبي',
  'دوري المؤتمر الأوروبي', 'كأس السوبر الأوروبي', 'بطولة أمم أوروبا',
  'دوري الأمم الأوروبية', 'دوري أبطال أفريقيا', 'كأس الكونفيدرالية الأفريقية',
  'كأس السوبر الأفريقي', 'كأس أمم أفريقيا', 'بطولة أمم أفريقيا للمحليين',
  'دوري روشن السعودي', 'الدوري المغربي الممتاز',
  'كأس آسيا', 'دوري أبطال آسيا للنخبة', 'دوري أبطال آسيا 2',
  'كأس الاتحاد الآسيوي', 'بطولات آسيا للفئات السنية',
  'بطولات غرب/شرق/جنوب/وسط آسيا', 'المباريات الودية الدولية',
  'كأس العالم وتصفياته', 'كوبا أمريكا', 'الكأس الذهبية للكونكاكاف',
  'دوري أمم الكونكاكاف', 'كأس أمم أوقيانوسيا', 'كأس العرب',
  'كأس العالم تحت 17/20 سنة', 'كرة القدم الأولمبية',
  'بطولات السيدات الأوروبية القارية',
]);

export const ALLOWED_TEAM_LABELS = Object.freeze([
  'Inter Miami CF',
  'Botafogo',
  'منتخب المغرب',
  'منتخب الجزائر',
]);
