import { Scene, OrthographicCamera, WebGLRenderer, Mesh, PlaneGeometry, MeshBasicMaterial, TextureLoader, SRGBColorSpace, LinearFilter } from 'three';

const root = document.querySelector('[data-app-showcase]');
if (root) {
  const frames = [...root.querySelectorAll('[data-showcase-frame]')];
  const canvas = root.querySelector('canvas');
  const label = root.querySelector('[data-showcase-label]');
  const progress = root.querySelector('[data-showcase-progress]');
  const pause = root.querySelector('[data-showcase-pause]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let selected = 0, paused = reduced.matches, visible = false, renderer, scene, camera;
  let meshes = [], starting = false, nextSlide = performance.now() + 7000, pointer;
  function selection(index, manual = false) {
    selected = (index + frames.length) % frames.length;
    frames.forEach((frame, i) => {
      frame.classList.toggle('is-active', i === selected);
      frame.setAttribute('aria-hidden', String(i !== selected));
    });
    label.textContent = frames[selected].dataset.title;
    progress.textContent = `${selected + 1} / ${frames.length}`;
    if (manual) nextSlide = performance.now() + 10000;
    render();
  }
  function render() {
    if (!renderer) return;
    meshes.forEach((mesh, i) => { mesh.visible = i === selected; });
    renderer.render(scene, camera);
  }
  function pauseState() {
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'تشغيل العرض المتتابع' : 'إيقاف العرض المتتابع مؤقتًا');
    pause.title = pause.getAttribute('aria-label');
    pause.querySelector('img').src = paused ? '/assets/icons/play.svg' : '/assets/icons/pause.svg';
  }
  root.querySelector('[data-showcase-next]').addEventListener('click', () => selection(selected + 1, true));
  root.querySelector('[data-showcase-prev]').addEventListener('click', () => selection(selected - 1, true));
  pause.addEventListener('click', () => { paused = !paused; nextSlide = performance.now() + 7000; pauseState(); });
  root.addEventListener('pointerdown', event => {
    if (!event.target.closest('button')) pointer = { x: event.clientX, y: event.clientY };
  });
  root.addEventListener('pointercancel', () => { pointer = null; });
  root.addEventListener('pointerup', event => {
    if (!pointer) return;
    const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
    pointer = null;
    if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.4) selection(selected + (x < 0 ? 1 : -1), true);
  });
  function size() {
    if (!renderer) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.left = -width / height / 2;
    camera.right = width / height / 2;
    camera.updateProjectionMatrix();
    meshes.forEach((mesh, i) => {
      const image = frames[i].querySelector('img');
      const aspect = Number(image.getAttribute('width')) / Number(image.getAttribute('height'));
      const imageHeight = Math.min(1, width / height / aspect);
      mesh.scale.set(imageHeight * aspect, imageHeight, 1);
    });
    render();
  }
  async function start() {
    if (renderer || starting || reduced.matches) return;
    starting = true;
    let candidate;
    try {
      candidate = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      scene = new Scene();
      camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
      camera.position.z = 2;
      const loader = new TextureLoader();
      const textures = await Promise.all(frames.map(frame => loader.loadAsync(frame.querySelector('img').src)));
      meshes = textures.map(texture => {
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.anisotropy = Math.min(4, candidate.capabilities.getMaxAnisotropy());
        const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: texture, toneMapped: false }));
        scene.add(mesh);
        return mesh;
      });
      renderer = candidate;
      size();
      root.dataset.renderer = 'webgl';
    } catch {
      candidate?.dispose();
      root.dataset.renderer = 'fallback';
    } finally { starting = false; }
  }
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) { start(); nextSlide = performance.now() + 7000; render(); }
  }, { threshold: 0.1 }).observe(root);
  new ResizeObserver(size).observe(canvas);
  document.addEventListener('visibilitychange', () => { nextSlide = performance.now() + 7000; if (!document.hidden) render(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; pauseState(); if (!reduced.matches) start(); });
  // Redraw only on slide/size changes; the fixed 3D frame is animated by the compositor.
  setInterval(() => {
    if (visible && !document.hidden && !paused && performance.now() >= nextSlide) {
      selection(selected + 1); nextSlide = performance.now() + 7000;
    }
  }, 1000);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); root.dataset.renderer = 'fallback'; renderer = null;
  });
  selection(0); pauseState();
}
