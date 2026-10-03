(() => {
  const canvas = document.getElementById('page-depth');
  if (!canvas || window.self !== window.top) return;
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    try {
      const THREE = await import('./three.module.min.js');
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
      camera.position.set(0, 3, 12);
      camera.lookAt(0, 0, 0);
      const surface = new THREE.Group();
      scene.add(surface);
      const geometry = new THREE.PlaneGeometry(32, 24, 16, 12);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x65d6a2, wireframe: true, transparent: true, opacity: 0.08, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2.6;
      mesh.position.y = -3;
      surface.add(mesh);
      const rear = mesh.clone();
      rear.material = mesh.material.clone();
      rear.material.color.setHex(0xda3c60);
      rear.material.opacity = 0.055;
      rear.position.set(7, -1, -5);
      rear.rotation.z = 0.2;
      surface.add(rear);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      let x = 0, y = 0, last = 0, frame = 0, animation = 0;
      const render = time => {
        if (!document.hidden && time - last >= 80) {
          last = time;
          surface.rotation.y += (x * 0.025 - surface.rotation.y) * 0.08;
          surface.rotation.x += (y * 0.018 - surface.rotation.x) * 0.08;
          renderer.render(scene, camera);
          canvas.dataset.frames = String(++frame);
        }
        if (!reduced.matches) animation = requestAnimationFrame(render);
      };
      const resize = () => {
        renderer.setSize(innerWidth, innerHeight, false);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      resize();
      window.addEventListener('resize', resize, { passive: true });
      window.addEventListener('pointermove', event => {
        if (reduced.matches) return;
        x = event.clientX / innerWidth * 2 - 1;
        y = event.clientY / innerHeight * 2 - 1;
      }, { passive: true });
      animation = requestAnimationFrame(render);
      window.addEventListener('pagehide', () => { cancelAnimationFrame(animation); renderer.dispose(); geometry.dispose(); mesh.material.dispose(); rear.material.dispose(); }, { once: true });
    } catch { canvas.hidden = true; }
  }
  // Video and metadata always load before the optional background renderer.
  document.getElementById('video')?.addEventListener('playing', () => setTimeout(start, 1500), { once: true });
  setTimeout(() => {
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 3000 });
    else start();
  }, 10000);
})();
