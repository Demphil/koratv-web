(() => {
  'use strict';
  if (window.PublisherAdWindow) return;
  const config = document.currentScript?.dataset || {};
  const source = config.source || 'https://al5sm.com/tag.min.js';
  const zones = (config.zones || '').split(',').filter(Boolean);
  const components = (config.components || '').split(',').filter(Boolean);
  const directUrl = config.directUrl || '';
  const key = 'publisher.ad-handoff.v1';
  const marker = 'publisher-ad-resume';
  const ttl = 10000;
  const ua = navigator.userAgent || '';
  const excludedBrowser = /Edg|OPR|SamsungBrowser|YaBrowser|UCBrowser|DuckDuckGo|Vivaldi|CriOS|FxiOS|;\s*wv\b|Version\/4\.0/i.test(ua) || Boolean(navigator.brave);
  const desktop = config.desktop === 'chrome-windows' && /Windows NT/.test(ua) && /Chrome\/\d/.test(ua) && !excludedBrowser;
  const mobile = config.mobileSwap === 'android-chrome' && /Android/.test(ua) && /Chrome\/\d/.test(ua) && !excludedBrowser;
  const protectedSelector = 'form,input,select,textarea,button,[role="button"],[contenteditable="true"],a[download],[data-no-popunder],[data-match-id],a[href*="fabor.sbs"],#player-container,#embed-modal';
  const registry = new Map();
  const realms = new Map();
  const removers = [];
  const dirtyForms = new Set();
  let pending = null, gesture = null, submitting = false, disposed = false, restoring = false;
  let incoming = null;
  try { incoming = new URLSearchParams(location.hash.slice(1)).get(marker); } catch {}
  const nativeOpen = window.open;
  const append = Node.prototype.appendChild;
  const log = (event, detail = {}) => {
    if (config.diagnostic !== '1') return;
    window.dispatchEvent(new CustomEvent('publisher-ad:diagnostic', { detail: { event, ...detail } }));
  };
  function listen(owner, type, handler, options) {
    owner.addEventListener(type, handler, options);
    removers.push(() => owner.removeEventListener(type, handler, options));
  }
  function isProtected(event) {
    return Boolean(event?.target?.closest?.(protectedSelector));
  }
  function protectControls() {
    const prior = window.onClickExcludes;
    const values = Array.isArray(prior) ? [...prior] : prior ? [prior] : [];
    for (const element of document.querySelectorAll(protectedSelector)) if (!values.includes(element)) values.push(element);
    window.onClickExcludes = values;
  }
  function fromNetwork() {
    const stack = new Error().stack || '';
    if (!stack.includes(source + ':') && !stack.includes(source + '?')) return false;
    return Array.from(document.scripts).some(script => script.src === source && zones.includes(script.dataset.zone));
  }
  function busy(acknowledging = false) {
    if (document.readyState === 'loading' || submitting || dirtyForms.size || incoming || (!acknowledging && document.visibilityState !== 'visible')) return true;
    if (window.top !== window || config.mode === 'player' || components.some(name => !registry.has(name))) return true;
    if (document.querySelector('[data-ad-busy="true"],[data-ad-keep-result="true"],[aria-busy="true"],dialog[open],#load-more:disabled')) return true;
    if (Array.from(document.querySelectorAll('input[type="file"]')).some(input => input.files?.length)) return true;
    if (Array.from(document.querySelectorAll('video,audio')).some(media => !media.paused || media.currentTime > 0 || media.src || media.srcObject)) return true;
    return false;
  }
  function canSwap() {
    return mobile && !pending && !busy() && navigator.userActivation?.isActive === true
      && gesture && Date.now() - gesture.time < 500 && !gesture.protected && !gesture.navigation;
  }
  function removeSnapshot() { try { sessionStorage.removeItem(key); } catch {} }
  function clearPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    removeSnapshot();
  }
  function snapshot(token) {
    const state = {};
    for (const name of components) state[name] = registry.get(name).capture();
    const result = { version: 1, token, created: Date.now(), url: location.pathname + location.search + location.hash,
      scroll: [window.scrollX, window.scrollY], state };
    if (JSON.stringify(result).length > 32768) throw new Error('State exceeds handoff limit');
    return result;
  }
  function handoff(original, receiver, destination) {
    let saved;
    const token = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
    try { saved = snapshot(token); sessionStorage.setItem(key, JSON.stringify(saved)); }
    catch { removeSnapshot(); return undefined; }
    const resume = new URL(location.href);
    resume.hash = marker + '=' + token;
    let child;
    try { child = Reflect.apply(original, receiver, [resume.href, '_blank', '']); }
    catch (error) { removeSnapshot(); throw error; }
    if (!child) { removeSnapshot(); log('handoff-blocked'); return null; }
    pending = { child, token, destination: destination.href, created: saved.created, url: saved.url, state: JSON.stringify(saved.state),
      timer: setTimeout(() => { clearPending(); log('handoff-timeout'); }, ttl) };
    log('handoff-opened');
    // This real window becomes the advertiser only after the publisher copy acknowledges.
    return window;
  }
  function desktopOpen(original, receiver, args) {
    const call = [...args];
    const features = String(call[2] || '').split(',').filter(Boolean)
      .filter(value => !/^\s*(popup|width|height|innerWidth|innerHeight|left|top|screenX|screenY)\s*(=|$)/i.test(value));
    features.push('popup=yes', 'width=640', 'height=480');
    call[2] = features.join(',');
    let requested = false;
    const cleanup = () => window.removeEventListener('blur', focusOnce);
    const focusOnce = () => {
      cleanup();
      if (requested || disposed) return;
      requested = true;
      window.focus();
      log('focus-request');
    };
    window.addEventListener('blur', focusOnce, { once: true });
    let result;
    try { result = Reflect.apply(original, receiver, call); }
    catch (error) { cleanup(); throw error; }
    setTimeout(cleanup, 250);
    // noopener/noreferrer can return null even when a window was opened.
    if (!result && !/\b(noopener|noreferrer)\b/i.test(String(args[2] || ''))) cleanup();
    log('popup-request', { realReference: Boolean(result) });
    return result;
  }
  function openAd(original, receiver, args) {
    if (disposed || (!desktop && !mobile) || /^_(self|parent|top|unfencedTop)$/i.test(String(args[1] || ''))) return Reflect.apply(original, receiver, args);
    let destination;
    try { destination = new URL(String(args[0] || 'about:blank'), location.href); }
    catch { return Reflect.apply(original, receiver, args); }
    const localLab = config.source?.startsWith('http://localhost:') && destination.protocol === 'http:' && destination.hostname === 'localhost';
    if (destination.href !== 'about:blank' && (destination.protocol !== 'https:' && !localLab
      || destination.origin === location.origin || /\.(m3u8|mp4|webm|mp3)(?:$|\?)/i.test(destination.pathname))) return Reflect.apply(original, receiver, args);
    if (canSwap() && destination.href !== 'about:blank' && (!args[1] || args[1] === '_blank') && !String(args[2] || '').trim()) {
      const result = handoff(original, receiver, destination);
      if (result !== undefined) return result;
    }
    return desktop ? desktopOpen(original, receiver, args) : Reflect.apply(original, receiver, args);
  }
  function adapt(owner) {
    if (realms.has(owner)) return;
    const original = owner.open;
    const wrapper = function (...args) {
      return fromNetwork() ? openAd(original, this, args) : Reflect.apply(original, this, args);
    };
    owner.open = wrapper;
    realms.set(owner, { original, wrapper });
  }
  function restoreFailure() {
    removeSnapshot();
    if (incoming) {
      history.replaceState(history.state, '', location.pathname + location.search);
      incoming = null;
    }
    log('restore-failed');
  }
  async function restore() {
    if (!incoming || restoring || document.readyState === 'loading' || components.some(name => !registry.has(name))) return;
    restoring = true;
    let saved;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw || raw.length > 32768) throw new Error('Missing state');
      saved = JSON.parse(raw);
      const url = new URL(saved.url, location.origin);
      const age = Date.now() - saved.created;
      if (saved.version !== 1 || saved.token !== incoming || !/^[a-f0-9]{32}$/.test(incoming) || !Number.isFinite(saved.created) || age < 0 || age > ttl
        || url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search
        || !Array.isArray(saved.scroll) || saved.scroll.length !== 2 || !saved.scroll.every(value => Number.isFinite(value) && value >= 0)
        || !saved.state || Object.keys(saved.state).sort().join(',') !== [...components].sort().join(',')) throw new Error('Invalid state');
      for (const name of components) if (await registry.get(name).restore(saved.state[name]) === false) throw new Error('Restore rejected');
      window.scrollTo(saved.scroll[0], saved.scroll[1]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const parent = window.opener;
      if (!parent || document.visibilityState !== 'visible' || !document.hasFocus()) throw new Error('Publisher not foreground');
      const token = incoming;
      history.replaceState(history.state, '', saved.url);
      removeSnapshot();
      incoming = null;
      window.opener = null;
      parent.postMessage({ type: 'publisher-ad-ready', token, visible: true }, location.origin);
      log('restored');
    } catch { restoreFailure(); }
  }
  listen(window, 'message', event => {
    if (!pending || event.origin !== location.origin || event.source !== pending.child || event.data?.type !== 'publisher-ad-ready'
      || event.data.token !== pending.token || event.data.visible !== true || Date.now() - pending.created > ttl) return;
    try {
      const currentState = {};
      for (const name of components) currentState[name] = registry.get(name).capture();
      if (busy(true) || location.pathname + location.search + location.hash !== pending.url || JSON.stringify(currentState) !== pending.state
        || pending.child.location.origin !== location.origin || pending.child.document.visibilityState !== 'visible'
        || !pending.child.document.hasFocus()) return;
      const destination = pending.destination;
      clearPending();
      window.opener = null;
      log('handoff-confirmed');
      location.replace(destination);
    } catch { clearPending(); }
  });
  listen(window, 'click', event => {
    if (!event.isTrusted) return;
    protectControls();
    gesture = { time: Date.now(), protected: isProtected(event), navigation: Boolean(event.target?.closest?.('a[href]'))
      || Boolean(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) };
  }, true);
  listen(document, 'input', event => { if (event.target?.form) dirtyForms.add(event.target.form); }, true);
  listen(document, 'reset', event => dirtyForms.delete(event.target), true);
  listen(document, 'submit', event => { submitting = true; queueMicrotask(() => { if (event.defaultPrevented) submitting = false; }); }, true);
  listen(document, 'DOMContentLoaded', () => { protectControls(); restore(); }, { once: true });
  listen(window, 'pagehide', clearPending);
  if (incoming) setTimeout(() => { if (incoming) restoreFailure(); }, ttl);
  if (desktop || mobile) adapt(window);
  const appendWrapper = function (node) {
    const eligible = !disposed && node instanceof HTMLIFrameElement && fromNetwork()
      && (!node.getAttribute('src') || node.getAttribute('src') === 'about:blank') && !node.hasAttribute('srcdoc');
    const result = Reflect.apply(append, this, [node]);
    if (eligible) try { if (node.contentWindow) { adapt(node.contentWindow); log('temporary-frame-adapted'); } } catch {}
    return result;
  };
  if (desktop || mobile) Node.prototype.appendChild = appendWrapper;
  window.PublisherAdWindow = {
    isProtected,
    register(name, component) {
      if (!components.includes(name) || typeof component?.capture !== 'function' || typeof component?.restore !== 'function') return;
      registry.set(name, component);
      restore();
    },
    openDirect(url, target, features) {
      const args = [url, target, features];
      return url === directUrl ? openAd(nativeOpen, window, args) : Reflect.apply(nativeOpen, window, args);
    },
    dispose() {
      disposed = true;
      clearPending();
      for (const remove of removers) remove();
      for (const [owner, entry] of realms) try { if (owner.open === entry.wrapper) owner.open = entry.original; } catch {}
      realms.clear();
      if (Node.prototype.appendChild === appendWrapper) Node.prototype.appendChild = append;
    }
  };
  if (document.readyState !== 'loading') { protectControls(); restore(); }
})();
