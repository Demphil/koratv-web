export const SUPPORT_HINT_KEY = 'watch-support-required-v1';
export const SUPPORT_HINT_TTL = 60 * 60 * 1000;

export function initialSupportState(hint, now = Date.now()) {
  const valid = hint?.blocked === true && Number.isFinite(hint.checkedAt)
    && now >= hint.checkedAt && now - hint.checkedAt < SUPPORT_HINT_TTL;
  return { blocked: valid, blockedChecks: 0, clearChecks: 0, verdict: 'unknown' };
}

export function evaluateSupport(state, sample) {
  if (!sample.controlHealthy || (sample.probe === 'unknown' && !sample.cosmeticHidden))
    return { ...state, blockedChecks: 0, clearChecks: 0, verdict: 'unknown' };
  const evidence = sample.cosmeticHidden || sample.probe === 'blocked';
  const blockedChecks = evidence ? state.blockedChecks + 1 : 0;
  const clearChecks = evidence ? 0 : state.clearChecks + 1;
  return { blocked: blockedChecks >= 2 ? true : clearChecks >= 2 ? false : state.blocked,
    blockedChecks, clearChecks, verdict: evidence ? 'blocked' : 'clear' };
}
