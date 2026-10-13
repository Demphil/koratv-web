export function isEuropeanYouthLeague(value) {
  const league = String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return /\b(?:uefa )?youth league\b/i.test(league)
    || /\bchampions league\b.*\b(?:youth|juniors?|u ?19|under ?19)\b|\b(?:youth|u ?19|under ?19)\b.*\bchampions league\b/i.test(league)
    || /(?:دوري|بطوله).*اوروبا.*(?:شباب|ناش[ئي]ين|تحت 19)|دوري الشباب الاوروبي/i.test(league);
}
