export const SUPPORT_HINT_KEY = 'watch-support-required-v1';
export const SUPPORT_HINT_TTL = 60 * 60 * 1000;

export function initialSupportState(hint, now = Date.now()) {
  const valid = hint?.blocked === true && Number.isFinite(hint.checkedAt)
    && now >= hint.checkedAt && now - hint.checkedAt < SUPPORT_HINT_TTL;
  return { blocked: valid, blockedChecks: 0, clearChecks: 0, verdict: 'unknown',
    reason: valid ? hint.reason === 'provider' ? 'provider' : 'local' : null };
}

export function providerSupportStatus(records) {
  const zones = new Set(['11908579', '11908582', '11949898']);
  const current = records.filter(record => zones.has(record.zone));
  if (!current.length) return 'not-started';
  if (current.some(record => record.policyBlocked)) return 'unknown';
  if (current.some(record => record.state === 'failed')) return 'failed';
  return current.every(record => record.state === 'ready') ? 'ready' : 'pending';
}

export function evaluateSupport(state, sample) {
  const providers = sample.providers || 'ready';
  const localEvidence = sample.cosmeticHidden || sample.probe === 'blocked';
  const providerEvidence = providers === 'failed';
  if (!sample.controlHealthy || (!localEvidence && !providerEvidence && sample.probe === 'unknown')
    || (!localEvidence && state.reason === 'provider' && providers !== 'ready' && !providerEvidence))
    return { ...state, blockedChecks: 0, clearChecks: 0, verdict: 'unknown' };
  const evidence = localEvidence || providerEvidence;
  const blockedChecks = evidence ? state.blockedChecks + 1 : 0;
  const clearChecks = evidence ? 0 : state.clearChecks + 1;
  return { blocked: blockedChecks >= 2 ? true : clearChecks >= 2 ? false : state.blocked,
    blockedChecks, clearChecks, verdict: evidence ? 'blocked' : 'clear',
    reason: evidence ? localEvidence ? 'local' : 'provider' : clearChecks >= 2 ? null : state.reason };
}
