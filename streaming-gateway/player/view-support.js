import { SUPPORT_HINT_KEY, initialSupportState, evaluateSupport } from './view-support-state.js';

function startSupportNotice() {
  const container = document.getElementById('player-container');
  const video = document.getElementById('video');
  const panel = document.getElementById('watch-support-panel');
  const button = document.getElementById('watch-support-check');
  const feedback = document.getElementById('watch-support-feedback');
  if (!container || !video || !panel || !button || !feedback) return;
  let hint;
  try { hint = JSON.parse(localStorage.getItem(SUPPORT_HINT_KEY) || 'null'); } catch {}
  let state = initialSupportState(hint);
  let started = !video.paused || video.currentTime > 0;
  let checking = false, timer, stopped = false, lastCheckAt = 0;
  const probeUrl = new URL('./ads/prebid-ads.js', import.meta.url);
  const revision = new URL(import.meta.url).searchParams.get('v');
  if (revision) probeUrl.searchParams.set('v', revision);
  const controlUrl = new URL('./icons/tv.svg', import.meta.url);
  const bait = document.createElement('div');
  bait.className = 'adsbox ad-banner advertisement';
  bait.setAttribute('aria-hidden', 'true');
  Object.assign(bait.style, { position: 'fixed', left: '-10000px', top: '0', width: '10px', height: '10px', pointerEvents: 'none' });
  document.body.appendChild(bait);

  function mount() {
    const host = container.querySelector('.plyr') || container;
    if (panel.parentElement !== host) host.appendChild(panel);
  }
  function render() {
    mount();
    const wasHidden = panel.hidden;
    panel.hidden = !started || !state.blocked;
    panel.dataset.state = state.blocked ? 'blocked' : state.verdict;
    button.disabled = checking;
    panel.setAttribute('aria-busy', String(checking));
    feedback.hidden = !checking && state.verdict !== 'unknown';
    feedback.dataset.kind = checking ? 'checking' : 'network';
    if (wasHidden && !panel.hidden && document.hasFocus()) button.focus({ preventScroll: true });
  }
  function persist() {
    try {
      if (state.blocked && state.verdict === 'blocked') localStorage.setItem(SUPPORT_HINT_KEY, JSON.stringify({ blocked: true, checkedAt: Date.now() }));
      else if (!state.blocked && state.clearChecks >= 2) localStorage.removeItem(SUPPORT_HINT_KEY);
    } catch {}
  }
  function schedule(delay = 30000) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => { if (document.visibilityState === 'visible' && started) check(); else schedule(); }, delay);
  }
  function sampleProbe() {
    return new Promise(resolve => {
      const script = document.createElement('script');
      const token = Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16)).join('-');
      let executed = false, done = false;
      const onProbe = event => { if (event.detail === token) executed = true; };
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        window.removeEventListener('watch-support-probe', onProbe);
        script.remove();
        resolve(value);
      };
      window.addEventListener('watch-support-probe', onProbe);
      script.dataset.probe = token;
      script.src = probeUrl.href;
      script.async = true;
      script.onload = () => finish(executed ? 'clear' : 'blocked');
      script.onerror = () => finish('blocked');
      const timeout = setTimeout(() => finish('unknown'), 3500);
      document.head.appendChild(script);
    });
  }
  async function check() {
    if (checking || stopped) return;
    checking = true;
    lastCheckAt = Date.now();
    render();
    try {
      const control = fetch(controlUrl, { method: 'HEAD', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(3500) })
        .then(response => response.ok).catch(() => false);
      const probe = sampleProbe();
      const [controlHealthy, probeResult] = await Promise.all([control, probe]);
      const style = getComputedStyle(bait);
      const cosmeticHidden = !bait.isConnected || bait.offsetHeight === 0 || bait.offsetWidth === 0
        || style.display === 'none' || style.visibility === 'hidden';
      if (stopped) return;
      state = evaluateSupport(state, { controlHealthy, probe: probeResult, cosmeticHidden });
      persist();
    } catch {
      state = evaluateSupport(state, { controlHealthy: false, probe: 'unknown' });
    } finally {
      checking = false;
      if (!stopped) {
        render();
        schedule(state.verdict !== 'unknown' && ((state.blockedChecks === 1) || (state.clearChecks === 1)) ? 1500 : 30000);
      }
    }
  }
  button.addEventListener('click', () => { clearTimeout(timer); check(); });
  panel.addEventListener('click', event => event.stopPropagation());
  panel.addEventListener('keydown', event => {
    if (panel.hidden) return;
    event.stopPropagation();
    if (event.key === 'Tab') {
      event.preventDefault();
      (button.disabled ? panel : button).focus({ preventScroll: true });
    }
  });
  video.addEventListener('playing', () => {
    started = true;
    render();
    if (Date.now() - lastCheckAt > 10000) check();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheckAt > 10000) check();
  });
  window.addEventListener('online', () => check());
  const observer = new MutationObserver(() => mount());
  observer.observe(container, { childList: true, subtree: true });
  window.addEventListener('pagehide', event => {
    if (event.persisted) { clearTimeout(timer); return; }
    stopped = true;
    clearTimeout(timer);
    observer.disconnect();
    bait.remove();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) check(); });
  render();
  check();
}

startSupportNotice();
