import { STORAGE_KEY, adDecision, consumeAd, httpsUrl } from './ads-policy.js';

const container = document.getElementById('player-container');
const video = document.getElementById('video');

function installShield(config) {
  let eligible = false;
  try { eligible = adDecision(config, JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')).eligible; } catch {}
  if (!eligible || !container || !video) return;
  const shield = document.createElement('button');
  shield.type = 'button';
  shield.className = 'ad-click-shield';
  shield.setAttribute('aria-label', 'تشغيل الفيديو (إعلان في علامة تبويب جديدة)');
  shield.title = 'تشغيل الفيديو';
  function remove() {
    shield.remove();
    window.removeEventListener('storage', onStorage);
  }
  function onStorage(event) { if (event.key === STORAGE_KEY) remove(); }
  shield.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    remove();
    let url;
    try { url = consumeAd(localStorage, config); } catch {}
    // noopener can return null on success: never fall back to parent navigation.
    try { if (url) window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
    video.play().catch(() => {});
  }, { once: true });
  window.addEventListener('storage', onStorage);
  container.append(shield);
}

function installDisplayAds(config) {
  const occupied = new Set();
  for (const item of config.display || []) {
    if (!item.enabled || !httpsUrl(item.script_url) || !['sidebar', 'footer'].includes(item.slot) || occupied.has(item.slot)) continue;
    const slot = document.getElementById(`ad-slot-${item.slot}`);
    if (!slot) continue;
    occupied.add(item.slot);
    const frame = document.createElement('iframe');
    frame.title = 'إعلان';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.height = String(Math.max(90, Math.min(600, Number(item.height) || 250)));
    frame.src = './ad-frame.html';
    frame.addEventListener('load', () => {
      // The sandbox has an opaque origin; send only public ad configuration.
      frame.contentWindow.postMessage({ type: 'koratv-ad-slot', config: item }, '*');
    }, { once: true });
    slot.hidden = false;
    slot.append(frame);
  }
}

async function start() {
  try {
    const response = await fetch('./ads-config.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const config = await response.json();
    if (config.enabled !== true) return;
    // Do not cover loading/error actions. Arm only after playable media arrives.
    if (video.readyState >= 2) installShield(config);
    else video.addEventListener('loadeddata', () => installShield(config), { once: true });
    const elapsed = performance.now();
    const delay = Math.max(0, (Number(config.initial_delay_seconds) || 0) * 1000 - elapsed);
    setTimeout(() => installDisplayAds(config), delay);
  } catch { /* Ads are optional; playback is not. */ }
}
start();
