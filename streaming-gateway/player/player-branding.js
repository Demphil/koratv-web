(() => {
  const video = document.getElementById('video');
  const container = document.getElementById('player-container');
  const overlay = document.getElementById('video-picture-overlay');
  if (!video || !container || !overlay) return;
  function position() {
    // Anchor to the contained video picture, not the fullscreen black bars.
    const width = video.clientWidth;
    const height = video.clientHeight;
    const ratio = (video.videoWidth || 16) / (video.videoHeight || 9);
    const pictureWidth = Math.min(width, height * ratio);
    const pictureHeight = pictureWidth / ratio;
    const rect = video.getBoundingClientRect();
    const host = container.getBoundingClientRect();
    const scaleX = host.width / container.clientWidth || 1;
    const scaleY = host.height / container.clientHeight || 1;
    Object.assign(overlay.style, {
      left: `${(rect.left - host.left) / scaleX + (width - pictureWidth) / 2}px`,
      top: `${(rect.top - host.top) / scaleY + (height - pictureHeight) / 2}px`,
      width: `${pictureWidth}px`, height: `${pictureHeight}px`,
    });
  }
  new ResizeObserver(position).observe(container);
  new ResizeObserver(position).observe(video);
  video.addEventListener('loadedmetadata', position);
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(position));
  window.addEventListener('resize', position);
  position();
})();
