(() => {
  'use strict';
  const script = document.currentScript;
  const measurementId = script?.dataset.measurementId;
  if (!/^G-[A-Z0-9]{6,}$/.test(measurementId || '')) return;
  if (script.dataset.bootstrap === 'true') {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
  }

  function record(event) {
    if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.dataset.disabledReason) return;
    let url;
    try { url = new URL(link.href, location.href); } catch { return; }
    let name;
    let details;
    if (url.origin === 'https://fabor.sbs' && url.pathname === '/739184.html'
      && /^\d{20}$/.test(url.searchParams.get('match') || '')) {
      name = 'match_open';
      // This measures navigation intent, not successful video playback.
      details = { destination: 'player', match_id: url.searchParams.get('match') };
    } else if (url.origin === location.origin && /^\/match\/[^/]+\/?$/.test(url.pathname)) {
      name = 'result_open';
      details = { destination: 'match_details' };
    } else return;
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, {
        ...details, send_to: measurementId, transport_type: 'beacon'
      });
    } catch { /* Measurement must never block navigation. */ }
  }

  document.addEventListener('click', record, true);
  document.addEventListener('auxclick', record, true);
})();
