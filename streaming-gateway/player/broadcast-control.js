/* global STREAM_API_ORIGIN, activeMatchId, embeddedMatchId, publicMatchId */
(() => {
  const container = document.getElementById('player-container');
  if (!container) return;
  const toast = document.createElement('aside');
  toast.className = 'broadcast-notice'; toast.hidden = true; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  const media = document.createElement('button'); media.type = 'button'; media.className = 'notice-media'; media.hidden = true; media.setAttribute('aria-label', 'عرض صورة الإشعار بحجم أكبر');
  const image = document.createElement('img'); image.alt = 'صورة الإشعار'; media.append(image);
  const text = document.createElement('p');
  const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق الإشعار'); close.textContent = '×';
  close.className = 'notice-close';
  toast.append(media, text, close); container.append(toast);
  const viewer = document.createElement('div'); viewer.className = 'notice-image-viewer'; viewer.hidden = true; viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-label', 'صورة الإشعار');
  const fullImage = document.createElement('img'); fullImage.alt = 'صورة الإشعار';
  const dismiss = close.cloneNode(true); viewer.append(fullImage, dismiss); container.append(viewer);
  function closeImage() { viewer.hidden = true; if (!toast.hidden) media.focus(); }
  dismiss.onclick = closeImage;
  media.onclick = () => { fullImage.src = image.src; viewer.hidden = false; dismiss.focus(); };
  viewer.onkeydown = event => { if (event.key === 'Escape') closeImage(); };
  image.onerror = () => { media.hidden = true; };
  let control, campaign = '', timer, cursor = 0, shown = 0, version, initialized = false, lastRevision = -1, disconnected = true;
  function matchKey() { const id = activeMatchId || embeddedMatchId; return /^\d{20}$/.test(id) ? id : id ? publicMatchId(id) : ''; }
  function progress() {
    try { const saved = JSON.parse(sessionStorage.getItem(`broadcast-notice:${campaign}`)); if (saved) return saved; } catch {}
    return { cursor: 0, shown: 0, nextAt: 0 };
  }
  function save(nextAt) { try { sessionStorage.setItem(`broadcast-notice:${campaign}`, JSON.stringify({ cursor, shown, nextAt })); } catch {} }
  function hide() { toast.hidden = true; viewer.hidden = true; }
  function next() {
    clearTimeout(timer); hide();
    const notices = control?.notices;
    if (!notices?.enabled || !notices.items.length || (notices.matchIds.length && !notices.matchIds.includes(matchKey())) || shown >= notices.items.length * notices.repeats) return;
    if (document.hidden) { timer = setTimeout(next, 1000); return; }
    const item = notices.items[cursor % notices.items.length];
    text.textContent = item.text; media.hidden = !item.image;
    if (item.image) image.src = `${STREAM_API_ORIGIN}${item.image}`;
    toast.style.setProperty('--notice-duration', `${notices.duration}s`);
    // Restart the traversal when consecutive notices reuse the same element.
    void toast.offsetWidth;
    toast.hidden = false; cursor++; shown++; save(Date.now() + (notices.duration + notices.interval) * 1000);
    timer = setTimeout(() => { hide(); timer = setTimeout(next, notices.interval * 1000); }, notices.duration * 1000);
  }
  close.onclick = () => { hide(); clearTimeout(timer); timer = setTimeout(next, (control?.notices.interval || 300) * 1000); };
  function apply(data) {
    if (!data || data.revision === lastRevision) return;
    lastRevision = data.revision; control = data;
    const nextVersion = data.channels[matchKey()];
    if (initialized && nextVersion && nextVersion !== version) window.refreshOperatorPlayback?.();
    version = nextVersion; initialized = true;
    if (!data.notices.enabled) { clearTimeout(timer); hide(); campaign = ''; return; }
    if (campaign !== data.notices.campaign) {
      campaign = data.notices.campaign; const saved = progress(); cursor = saved.cursor; shown = saved.shown;
      clearTimeout(timer); hide(); timer = setTimeout(next, Math.max(0, saved.nextAt - Date.now()));
    }
  }
  const events = new EventSource(`${STREAM_API_ORIGIN}/api/broadcast-events`);
  events.addEventListener('control', event => { disconnected = false; try { apply(JSON.parse(event.data)); } catch {} });
  events.onerror = () => { disconnected = true; };
  const fallback = setInterval(() => {
    if (!disconnected || document.hidden) return;
    fetch(`${STREAM_API_ORIGIN}/api/broadcast-control`, { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(response => response.ok ? response.json() : null).then(apply).catch(() => {});
  }, 15000);
  window.addEventListener('pagehide', () => { events.close(); clearInterval(fallback); clearTimeout(timer); });
})();
