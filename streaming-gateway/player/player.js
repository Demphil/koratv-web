/* global Hls, STREAM_API_ORIGIN */
const video = document.getElementById('video');
const status = document.getElementById('status');
const entry = new URL(location.href).searchParams.get('token');
history.replaceState(null, '', location.pathname);
let hls;
let expiryTimer;
async function start() {
  if (!entry) throw new Error('Missing playback ticket. Open the match again.');
  if (!Hls.isSupported()) throw new Error('This browser does not support the required MediaSource playback.');
  const response = await fetch(`${STREAM_API_ORIGIN}/api/redeem-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: entry }), credentials: 'omit',
  });
  if (!response.ok) throw new Error('Playback ticket expired, was already used, or access was denied.');
  const { token, expiresIn } = await response.json();
  hls = new Hls({ enableWorker: true });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) { hls.destroy(); status.textContent = 'Playback failed. Open the match again.'; }
  });
  hls.loadSource(`${STREAM_API_ORIGIN}/api/stream.m3u8?token=${encodeURIComponent(token)}`);
  hls.attachMedia(video);
  expiryTimer = setTimeout(() => {
    hls.destroy();
    video.removeAttribute('src');
    video.load();
    status.textContent = 'Session expired after five minutes. Open the match again.';
  }, expiresIn * 1000);
}
// Convenience restrictions only. Browser menus and network inspection remain accessible.
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.key === 'F12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && /^[ijc]$/i.test(event.key))) event.preventDefault();
});
window.addEventListener('pagehide', () => { clearTimeout(expiryTimer); hls?.destroy(); });
start().catch((error) => { status.textContent = error.message; });
