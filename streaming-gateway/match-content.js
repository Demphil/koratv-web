import { createHash } from 'node:crypto';
import { teamIdentityAliases } from '../shared/match-broadcasts.mjs';
import { DEFAULT_STREAM_OPENS_BEFORE_MINUTES, sourceMatchState } from '../shared/match-lifecycle.mjs';
import { inspectContentFrames } from './content-ocr.js';

const codes = {
  'ac milan': ['MIL'], bologna: ['BOL'], inter: ['INT'], venezia: ['VEN'], parma: ['PAR'], udinese: ['UDI'],
  napoli: ['NAP'], juventus: ['JUV'], monza: ['MON'], genoa: ['GEN'], 'as roma': ['ROM'], atalanta: ['ATA'],
  'real madrid': ['RMA', 'MAD'], barcelona: ['BAR', 'FCB'], 'atletico madrid': ['ATM'],
  'manchester city': ['MCI'], 'manchester united': ['MUN'], liverpool: ['LIV'], arsenal: ['ARS'],
  chelsea: ['CHE'], 'tottenham hotspur': ['TOT'], 'newcastle united': ['NEW'],
  'bayern munich': ['BAY', 'FCB'], 'borussia dortmund': ['BVB', 'DOR'], 'paris saint germain': ['PSG'],
  'raja casablanca': ['RCA'], 'hassania agadir': ['HUSA', 'HUS'], 'far rabat': ['FAR', 'ASFAR'],
  'fus rabat': ['FUS'], 'ittihad tanger': ['IRT'], 'renaissance zemamra': ['RCAZ'],
  'al faisaly': ['FAISALY'], 'al taawoun': ['TAAWOUN'], 'al khaldiya': ['KHALDIYA'],
};
const normalized = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/(\p{L})(\d)|(\d)(\p{L})/gu, (_, a, b, c, d) => `${a || c} ${b || d}`)
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const idOf = row => row?.match_id || row?.matchId || row?.id || '';
const cancelled = () => ({ status: 'pending', reason: 'content_inspection_cancelled' });
async function abortable(task, signal) {
  if (!signal) return task;
  if (signal.aborted) return cancelled();
  let onAbort;
  const abort = new Promise(resolve => { onAbort = () => resolve(cancelled()); signal.addEventListener('abort', onAbort, { once: true }); });
  try { return await Promise.race([task, abort]); } finally { signal.removeEventListener('abort', onAbort); }
}

export function contentWindow(row, now = Date.now()) {
  const kickoff = Date.parse(row?.kickoff_time || row?.scheduledAt || row?.payload?.scheduledAt);
  return Number.isFinite(kickoff) && now >= kickoff - DEFAULT_STREAM_OPENS_BEFORE_MINUTES * 60_000
    && !['ended', 'unavailable'].includes(sourceMatchState(row?.payload || row));
}

function aliases(row, side) {
  const payload = row.payload || {};
  const values = [row[`${side}_team`], row[`${side}Team`], payload[`${side}TeamEnglish`],
    ...(Array.isArray(payload[`${side}TeamEnglishAliases`]) ? payload[`${side}TeamEnglishAliases`] : []), payload[`${side}TeamCode`]].filter(value => typeof value === 'string');
  const expanded = values.flatMap(value => teamIdentityAliases(value, row));
  for (const name of [...expanded]) expanded.push(...(codes[normalized(name)] || []));
  return [...new Set(expanded.map(normalized).filter(value => value.length >= 3))];
}

const contains = (text, name) => (` ${text} `).includes(` ${name} `)
  || name.replace(/ /g, '').length >= 6 && text.replace(/ /g, '').includes(name.replace(/ /g, ''));
function pairVisible(row, text) {
  const home = aliases(row, 'home'), away = aliases(row, 'away');
  return home.some(a => away.every(b => b !== a) && contains(text, a))
    && away.some(b => home.every(a => a !== b) && contains(text, b));
}

function otherKnownTeams(match, text) {
  const expected = [...aliases(match, 'home'), ...aliases(match, 'away')];
  const found = Object.entries(codes).filter(([name, values]) => {
    const options = [name, ...values.map(normalized)];
    return !options.some(value => expected.includes(value)) && options.some(value => contains(text, value)
      && (value.length > 3 || Object.values(codes).filter(list => list.map(normalized).includes(value)).length === 1));
  }).map(([name]) => name);
  return found.length >= 2 ? found.sort().slice(0, 2) : null;
}

export function identifyContent(match, samples, fixtures = [], now = Date.now()) {
  const kickoff = Date.parse(match?.kickoff_time || match?.scheduledAt);
  const results = (samples || []).map(words => {
    const raw = words.filter(word => word.confidence >= 50).map(word => word.text).join(' ');
    const text = normalized(raw);
    const clock = raw.match(/\b(\d{1,3})\s*[:.]\s*(\d{2})\b/);
    const scoreboard = Boolean(clock || /\bvs\b|\bv\b|\d\s*[-:]\s*\d/i.test(raw));
    if (!scoreboard) return { status: 'pending', reason: 'no_scoreboard' };
    const second = clock ? Number(clock[1]) * 60 + Number(clock[2]) : null;
    if (pairVisible(match, text)) {
      const minute = clock ? Number(clock[1]) : null;
      const expected = Number(match.payload?.minute ?? match.payload?.liveMinute);
      const stale = minute !== null && (now < kickoff && minute > 10
        || Number.isFinite(expected) && expected > 0 && Math.abs(expected - minute) > 15);
      return stale ? { status: 'mismatch', reason: 'replay_clock', second }
        : { status: 'verified', reason: 'both_teams_visible', second };
    }
    const other = fixtures.find(row => idOf(row) !== idOf(match) && pairVisible(row, text));
    if (other) return { status: now < kickoff ? 'pending' : 'mismatch', reason: 'different_fixture', observedMatchId: idOf(other), second };
    const observedTeams = otherKnownTeams(match, text);
    return observedTeams ? { status: now < kickoff ? 'pending' : 'mismatch', reason: 'different_teams', observedTeams, second }
      : { status: 'pending', reason: 'teams_not_readable' };
  });
  const consistent = status => results.length >= 2 && results.every(row => row.status === status
    && row.reason === results[0].reason && row.observedMatchId === results[0].observedMatchId
    && JSON.stringify(row.observedTeams) === JSON.stringify(results[0].observedTeams)
    && (row.second === null && results[0].second === null || Math.abs(row.second - results[0].second) <= 5));
  if (consistent('verified') || consistent('mismatch')) {
    const { second, ...verdict } = results[0];
    return { ...verdict, samples: results.length };
  }
  return { status: 'pending', reason: results[0]?.reason || 'no_content_evidence', samples: results.length };
}

export function createMatchContentVerifier({ enabled = false, inspect = inspectContentFrames, now = Date.now,
  ttlMs = 90_000, language = 'eng+ara' } = {}) {
  const cache = new Map(), inflight = new Map();
  let tail = Promise.resolve();
  const keyOf = ({ match, provider, source }) => createHash('sha256')
    .update(JSON.stringify([idOf(match), match?.kickoff_time || match?.scheduledAt, aliases(match || {}, 'home'), aliases(match || {}, 'away'), provider, source])).digest('hex');
  return {
    enabled,
    idle: () => tail.catch(() => {}),
    latest(input) {
      const row = cache.get(keyOf(input));
      return row?.expiresAt > now() ? row.value : row?.value.blocked
        ? { ...row.value, status: 'pending', reason: 'content_mismatch_unresolved' } : null;
    },
    async verify(input) {
      if (!enabled) return { status: 'disabled', reason: 'content_verification_disabled' };
      if (!input.match || !contentWindow(input.match, now())) return { status: 'pending', reason: 'outside_content_window' };
      const key = keyOf(input), cached = cache.get(key);
      if (cached?.expiresAt > now()) return cached.value;
      if (inflight.has(key)) return abortable(inflight.get(key), input.signal);
      const task = tail.catch(() => {}).then(async () => {
        if (input.signal?.aborted) return cancelled();
        let verdict;
        try {
          const samples = await inspect(input.segment, { language });
          verdict = { ...identifyContent(input.match, samples, input.fixtures, now()), ...(samples.engine ? { engine: samples.engine } : {}) };
        }
        catch (error) { verdict = { status: 'pending', reason: error?.message === 'content_inspector_unavailable' ? error.message : 'content_inspection_failed' }; }
        if (input.signal?.aborted) return cancelled();
        const blocked = verdict.status === 'mismatch' || verdict.status !== 'verified' && cached?.value.blocked;
        const value = { ...verdict, checkedAt: new Date(now()).toISOString(), provider: input.provider,
          ...(blocked ? { blocked: true, lastMismatchAt: verdict.status === 'mismatch' ? new Date(now()).toISOString() : cached.value.lastMismatchAt } : {}) };
        cache.delete(key);
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      });
      inflight.set(key, task); tail = task;
      task.then(() => inflight.delete(key), () => inflight.delete(key));
      return abortable(task, input.signal);
    }
  };
}
