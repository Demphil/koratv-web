const ALLOWED_LEAGUE_PATTERNS = [
  /دوري ابطال اوروبا|uefa champions league|champions league/i,
  /الدوري الانجليزي الممتاز|^(?:english )?premier league$/i,
  /الدوري الاسباني(?!.*درجه)|^(?:la liga|spanish primera(?: division)?)$/i,
  /الدوري الايطالي(?!.*درجه)|^(?:serie a|italian serie a)$/i,
  /الدوري الالماني(?!.*درجه)|^(?:(?:1\.?\s*)?bundesliga|german bundesliga)$/i,
  /الدوري الفرنسي(?!.*درجه)|^(?:ligue 1|french ligue 1)$/i,
  /الدوري الاوروبي|uefa europa league|europa league/i,
  /دوري المؤتمر الاوروبي|uefa conference league|conference league/i,
  /كاس السوبر الاوروبي|uefa super cup|european super cup/i,
  /بطوله امم اوروبا|uefa euro|european championship/i,
  /دوري الامم الاوروبيه|uefa nations league|nations league/i,
  /دوري ابطال افريقيا|caf champions league/i,
  /كاس الكونف(?:ي?دراليه|دراليه) الافريقيه|caf confederation cup/i,
  /كاس السوبر الافريقي|caf super cup/i,
  /كاس امم افريقيا|africa cup of nations|afcon/i,
  /كاس الخليج(?: العربي)?|gulf cup(?: of nations)?|arabian gulf cup/i,
  /بطوله امم افريقيا للمحليين|african nations championship|chan/i,
  /الدوري المغربي الممتاز|البطوله الوطنيه الاحترافيه المغربيه|البطولة الوطنية الاحترافية المغربية|^(?:botola(?:\s*pro)?|moroccan botola(?:\s*pro)?)$/i,
  /كاس اسيا|كأس اسيا|كاس امم اسيا|كأس امم اسيا|afc asian cup|asian cup/i,
  /دوري ابطال اسيا|دوري ابطال اسيا للنخبه|كاس الاتحاد الاسيوي|كأس الاتحاد الاسيوي|afc champions league|afc champions league elite|afc champions league two|afc cup|afc challenge league/i,
  /بطوله اسيا تحت \d+|كاس اسيا تحت \d+|afc u(?:17|20|23)|afc asian cup u(?:17|20|23)/i,
  /بطوله غرب اسيا|كاس غرب اسيا|waff championship|west asian championship/i,
  /بطوله شرق اسيا|كاس شرق اسيا|eaff championship|east asian championship/i,
  /بطوله جنوب اسيا|كاس جنوب اسيا|saff championship|south asian championship/i,
  /بطوله وسط اسيا|كاس وسط اسيا|cafa nations cup|central asian/i,
  /بطوله وديه|مباراه وديه|مباريات وديه|وديه دوليه|ودية دولية|international friendl(?:y|ies)|friendly international|^friendlies$/i,
  /كاس العالم|تصفيات كاس العالم|fifa world cup|world cup qualification|world cup qualifier/i,
  /كوبا امريكا|copa america/i,
  /الكاس الذهبيه|كأس الكونكاكاف الذهبية|concacaf gold cup|concacaf nations league/i,
  /كاس امم اوقيانوسيا|ofc nations cup/i,
  /كاس العرب|arab cup|fifa arab cup/i,
  /كاس العالم تحت \d+|fifa u(?:17|20) world cup/i,
  /كره القدم الاولمبيه|olympic football|olympics football/i,
  /دوري روشن السعودي|saudi pro league|roshn saudi league/i,
];

const WOMEN_MARKERS = /سيدات|نسائي|نساء|women|woman|female|lad(?:y|ies)|feminin|femminil|femenin|femenil|femmes?|frauen|damen|\bw\b/i;
const OUT_OF_SCOPE_LEAGUE_PATTERNS = [
  /canadian premier league|friendlies clubs|club friendlies|copa de la liga/i,
  /\bbotola\s*2\b|\bpremier league\s*2\b|\bbundesliga\s*2\b/i,
  /الدوري المغربي.*(?:الثاني|الدرجة الثانية|القسم الثاني)|البطولة.*(?:الثاني|الدرجة الثانية|القسم الثاني)/i,
];
const YOUTH_MARKER = /\bu\s*(?:17|18|19|20|21|23)\b|\bunder\s*(?:17|18|19|20|21|23)\b|تحت\s*(?:17|18|19|20|21|23)/i;
const ALLOWED_YOUTH_COMPETITION = /^(?:afc u(?:17|20|23)|afc asian cup u(?:17|20|23)|بطوله اسيا تحت (?:17|20|23)|كاس اسيا تحت (?:17|20|23)|fifa u(?:17|20) world cup|كاس العالم تحت (?:17|20))$/i;

function isOutOfScopeLeague(value) {
  const normalized = normalizeLeagueName(value);
  if (!normalized || OUT_OF_SCOPE_LEAGUE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return YOUTH_MARKER.test(normalized) && !ALLOWED_YOUTH_COMPETITION.test(normalized);
}

function isMoroccanTopTierLeague(value) {
  return /^(?:botola(?:\s*pro)?|moroccan botola(?:\s*pro)?|morocco botola(?:\s*pro)?|الدوري المغربي(?: الممتاز)?|البطوله الوطنيه الاحترافيه المغربيه|البطولة الوطنية الاحترافية المغربية)$/i
    .test(normalizeLeagueName(value));
}

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

export function isAllowedLeague(value) {
  const normalized = normalizeLeagueName(value);
  if (isOutOfScopeLeague(normalized)) return false;
  if (WOMEN_MARKERS.test(normalized)) return false;
  return Boolean(normalized && ALLOWED_LEAGUE_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function normalizeCountryName(value) {
  return normalizeLeagueName(value).toLocaleLowerCase('en');
}

function isAllowedApiFootballLeague(value, country = '') {
  const normalized = normalizeLeagueName(value).toLocaleLowerCase('en');
  const normalizedCountry = normalizeCountryName(country);
  if (isOutOfScopeLeague(value)) return false;
  if (/botola|الدوري المغربي|البطوله الوطنيه الاحترافيه المغربيه/.test(normalized)) {
    return (!normalizedCountry || /morocco|المغرب/.test(normalizedCountry)) && isMoroccanTopTierLeague(value);
  }
  if (!normalizedCountry) return isAllowedLeague(value);
  if (/^(?:english )?premier league$/.test(normalized)) return /england/.test(normalizedCountry);
  if (/^serie a$/.test(normalized)) return /italy/.test(normalizedCountry);
  if (/^bundesliga$/.test(normalized)) return /germany/.test(normalizedCountry);
  if (/^ligue 1$/.test(normalized)) return /france/.test(normalizedCountry);
  if (/^(?:la liga|spanish primera(?: division)?)$/.test(normalized)) return /spain/.test(normalizedCountry);
  if (/^national(?:\s*1)?$/.test(normalized)) return /france/.test(normalizedCountry);
  if (/botola|البطوله الوطنيه الاحترافيه المغربيه|الدوري المغربي/.test(normalized)) return /morocco|المغرب/.test(normalizedCountry);
  if (/saudi pro league|pro league|roshn/.test(normalized)) return /saudi/.test(normalizedCountry);
  return isAllowedLeague(value);
}

const ALLOWED_TEAM_PATTERNS = [
  /inter\s*miami|inter\s*miami\s*cf|انتر\s*ميامي|إنتر\s*ميامي/i,
  /^(?:botafogo(?:\s+(?:fr|rj|de\s+futebol\s+e\s+regatas))?|بوتافوغو|بوتافوجو|بوتافوقو)$/i,
];

const NATIONAL_TEAM_EXCEPTIONS = [
  /^(?:منتخب\s*)?المغرب(?:\s*للسيدات)?$|^morocco(?:\s*women)?$|^maroc(?:\s*femmes)?$/i,
  /^(?:منتخب\s*)?الجزا[ئي]ر(?:\s*للسيدات)?$|^algeria(?:\s*women)?$|^algerie(?:\s*femmes)?$|^algérie(?:\s*femmes)?$/i,
];

export function isAllowedTeam(value) {
  const normalized = normalizeTeamName(value);
  if (WOMEN_MARKERS.test(normalized)) return false;
  return Boolean(normalized && ALLOWED_TEAM_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export function isAllowedNationalTeamException(value) {
  const normalized = normalizeTeamName(value);
  if (WOMEN_MARKERS.test(normalized)) return false;
  return Boolean(normalized && NATIONAL_TEAM_EXCEPTIONS.some((pattern) => pattern.test(normalized)));
}

export function isAllowedMatch({ league = '', country = '', leagueCountry = '', homeTeam = '', awayTeam = '' } = {}) {
  const normalizedLeague = normalizeLeagueName(league);
  if ([league, homeTeam, awayTeam].some((value) => WOMEN_MARKERS.test(normalizeLeagueName(value)))) return false;
  if ([homeTeam, awayTeam].some((team) => YOUTH_MARKER.test(normalizeTeamName(team)))
    && !ALLOWED_YOUTH_COMPETITION.test(normalizedLeague)) return false;
  return isAllowedApiFootballLeague(league, country || leagueCountry)
    || isAllowedTargetClubMatch({ league, country: country || leagueCountry, homeTeam, awayTeam });
}

function isAllowedTargetClubMatch({ league, country, homeTeam, awayTeam }) {
  const normalizedLeague = normalizeLeagueName(league).toLocaleLowerCase('en');
  const normalizedCountry = normalizeCountryName(country);
  const teams = [homeTeam, awayTeam]
    .filter(isAllowedTeam)
    .map((team) => normalizeTeamName(team).toLocaleLowerCase('en'));
  if (teams.some((team) => /^botafogo(?: fr| rj| de futebol e regatas)?$/.test(team))) {
    const brazilTopTier = /brazil|brasil/.test(normalizedCountry)
      || /brazilian serie a|campeonato brasileiro serie a|brasileirao/.test(normalizedLeague);
    return brazilTopTier && /^(?:brazilian serie a|campeonato brasileiro serie a|brasileirao|serie a)$/.test(normalizedLeague);
  }
  if (teams.some((team) => /^inter miami(?: cf)?$/.test(team))) {
    return /^(?:major league soccer|mls)$/.test(normalizedLeague)
      && (!normalizedCountry || /united states|usa|us/.test(normalizedCountry));
  }
  return false;
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
  'دوري أمم الكونكاكاف', 'كأس أمم أوقيانوسيا', 'كأس العرب', 'كأس الخليج العربي',
  'كأس العالم تحت 17/20 سنة', 'كرة القدم الأولمبية',
]);

export const ALLOWED_TEAM_LABELS = Object.freeze([
  'Inter Miami CF',
  'Botafogo',
  'منتخب المغرب',
  'منتخب الجزائر',
]);
