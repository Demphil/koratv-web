const canvas = document.getElementById('operator-depth');
async function start() {
  if (!canvas) return;
  try {
    const THREE = await import('./three.module.min.js');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1, .1, 80);
    camera.position.set(0, 3, 12); camera.lookAt(0, 0, 0);
    const surface = new THREE.Group(); scene.add(surface);
    const geometry = new THREE.PlaneGeometry(32, 24, 16, 12);
    const front = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x65d6a2, wireframe: true, transparent: true, opacity: .12, depthWrite: false }));
    front.rotation.x = -Math.PI / 2.6; front.position.y = -3; surface.add(front);
    const rear = front.clone(); rear.material = front.material.clone(); rear.material.color.setHex(0xda3c60); rear.material.opacity = .10;
    rear.position.set(7, -1, -5); rear.rotation.z = .2; surface.add(rear);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let animation = 0, last = 0, frames = 0, x = 0, y = 0;
    function draw() { renderer.render(scene, camera); canvas.dataset.frames = String(++frames); }
    function tick(time) {
      if (!document.hidden && time - last >= 100) {
        last = time;
        surface.rotation.y = Math.sin(time / 16000) * .04 + x * .025;
        surface.rotation.x = Math.cos(time / 20000) * .012 + y * .018;
        draw();
      }
      if (!document.hidden && !reduced.matches) animation = requestAnimationFrame(tick);
    }
    function resume() { cancelAnimationFrame(animation); if (!document.hidden && !reduced.matches) animation = requestAnimationFrame(tick); else if (!document.hidden) draw(); }
    function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); draw(); }
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', event => { if (!reduced.matches) { x = event.clientX / innerWidth * 2 - 1; y = event.clientY / innerHeight * 2 - 1; } }, { passive: true });
    document.addEventListener('visibilitychange', resume); reduced.addEventListener('change', resume);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(animation); canvas.hidden = true; });
    canvas.addEventListener('webglcontextrestored', () => { canvas.hidden = false; resize(); resume(); });
    window.addEventListener('pagehide', event => { cancelAnimationFrame(animation); if (!event.persisted) { renderer.dispose(); geometry.dispose(); front.material.dispose(); rear.material.dispose(); } });
    window.addEventListener('pageshow', event => { if (event.persisted) { resize(); resume(); } });
    resize(); resume();
  } catch { canvas.hidden = true; }
}
// Initialize the optional scene after the dashboard's first paint.
if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 });
else setTimeout(start, 300);
