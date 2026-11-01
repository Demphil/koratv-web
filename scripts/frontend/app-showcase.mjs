import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, BoxGeometry, PlaneGeometry,
  MeshStandardMaterial, MeshBasicMaterial, AmbientLight, DirectionalLight, TextureLoader,
  SRGBColorSpace, LinearFilter, MathUtils
} from 'three';

const root = document.querySelector('[data-app-showcase]');
if (root) {
  const frames = [...root.querySelectorAll('[data-showcase-frame]')];
  const canvas = root.querySelector('canvas');
  const label = root.querySelector('[data-showcase-label]');
  const progress = root.querySelector('[data-showcase-progress]');
  const pause = root.querySelector('[data-showcase-pause]');
  const mobile = matchMedia('(max-width: 700px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dialog = root.querySelector('dialog');
  let selected = 0, paused = reduced.matches, visible = false, renderer, scene, camera;
  let groups = [], frameId, lastRender = 0, nextSlide = performance.now() + 6000, pointer, starting = false;
  function selection(index, manual = false) {
    selected = (index + frames.length) % frames.length;
    for (const [i, frame] of frames.entries()) {
      frame.classList.toggle('is-active', i === selected);
      frame.setAttribute('aria-hidden', String(mobile.matches && i !== selected));
    }
    label.textContent = frames[selected].dataset.title;
    progress.textContent = `${selected + 1} / ${frames.length}`;
    if (manual) nextSlide = performance.now() + 10000;
    if (renderer && (reduced.matches || document.hidden)) render(performance.now(), true);
  }
  function pauseState() {
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'تشغيل العرض المتتابع' : 'إيقاف العرض المتتابع مؤقتًا');
    pause.title = pause.getAttribute('aria-label');
    pause.querySelector('img').src = paused ? '/assets/icons/play.svg' : '/assets/icons/pause.svg';
  }
  root.querySelector('[data-showcase-next]').addEventListener('click', () => selection(selected + 1, true));
  root.querySelector('[data-showcase-prev]').addEventListener('click', () => selection(selected - 1, true));
  pause.addEventListener('click', () => { paused = !paused; nextSlide = performance.now() + 6000; pauseState(); });
  root.addEventListener('pointerdown', event => {
    if (event.target.closest('button,dialog')) return;
    pointer = { x: event.clientX, y: event.clientY };
  });
  root.addEventListener('pointerup', event => {
    if (!pointer) return;
    const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
    pointer = null;
    if (mobile.matches && Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.4) selection(selected + (x < 0 ? 1 : -1), true);
  });
  root.querySelector('[data-showcase-expand]').addEventListener('click', () => {
    const image = dialog.querySelector(':scope > img');
    image.src = frames[selected].dataset.full;
    image.alt = frames[selected].querySelector('img').alt;
    dialog.querySelector('p').textContent = frames[selected].dataset.title;
    dialog.showModal();
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { nextSlide = performance.now() + 6000; });
  function size() {
    if (!renderer) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2400000 / (width * height))));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const sceneWidth = mobile.matches ? 1.28 : 7.85;
    camera.position.z = Math.max(2.1 / (2 * Math.tan(MathUtils.degToRad(16))), sceneWidth / (2 * Math.tan(MathUtils.degToRad(16)) * camera.aspect)) * 1.05;
    camera.updateProjectionMatrix();
    selection(selected);
    render(performance.now(), true);
  }
  function render(time, snap = false) {
    if (!renderer) return;
    groups.forEach((group, index) => {
      const delta = index - selected;
      group.visible = !mobile.matches || Math.abs(delta) < 2;
      const target = mobile.matches ? delta * 1.65 : (index - 2.5) * 1.32;
      group.position.x = MathUtils.lerp(group.position.x, target, mobile.matches && !snap ? 0.15 : 1);
      group.position.y = reduced.matches ? 0 : Math.sin(time / 1600 + index * 0.6) * 0.035;
      group.rotation.y = reduced.matches ? 0 : Math.sin(time / 2400 + index * 0.4) * 0.045;
      group.rotation.x = reduced.matches ? 0 : Math.sin(time / 2900) * 0.018;
    });
    renderer.render(scene, camera);
  }
  function animate(time) {
    if (!visible || document.hidden) { frameId = null; return; }
    if (!paused && !dialog.open && time >= nextSlide) { selection(selected + 1); nextSlide = time + 6000; }
    if (time - lastRender >= 1000 / 24) { render(time); lastRender = time; }
    frameId = requestAnimationFrame(animate);
  }
  function schedule() {
    if (!visible || document.hidden) { if (frameId) cancelAnimationFrame(frameId); frameId = null; return; }
    if (reduced.matches) { if (frameId) cancelAnimationFrame(frameId); frameId = null; render(performance.now()); return; }
    if (renderer && !reduced.matches && !frameId) frameId = requestAnimationFrame(animate);
  }
  async function start() {
    if (renderer || starting || reduced.matches) return;
    starting = true;
    let candidate;
    try {
      candidate = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      scene = new Scene();
      camera = new PerspectiveCamera(32, 1, 0.1, 30);
      scene.add(new AmbientLight(0xffffff, 2.2));
      const light = new DirectionalLight(0xc7ffe8, 3); light.position.set(2, 3, 4); scene.add(light);
      const loader = new TextureLoader();
      const textures = await Promise.all(frames.map(frame => loader.loadAsync(frame.querySelector('img').src)));
      groups = textures.map((texture, index) => {
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.anisotropy = Math.min(4, candidate.capabilities.getMaxAnisotropy());
        const group = new Group();
        const rim = new Mesh(new BoxGeometry(1.15, 2.025, 0.055), new MeshStandardMaterial({ color: index % 2 ? 0xb53b5b : 0x238d70, metalness: 0.65, roughness: 0.3 }));
        const image = new Mesh(new PlaneGeometry(1.08, 1.92), new MeshBasicMaterial({ map: texture, toneMapped: false }));
        image.position.z = 0.032;
        group.add(rim, image); scene.add(group);
        return group;
      });
      renderer = candidate;
      root.dataset.renderer = 'webgl';
      size(); schedule();
    } catch {
      candidate?.dispose();
      root.dataset.renderer = 'fallback';
    } finally { starting = false; }
  }
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) { start(); nextSlide = performance.now() + 6000; }
    schedule();
  }, { threshold: 0.1 });
  observer.observe(root);
  new ResizeObserver(size).observe(root);
  document.addEventListener('visibilitychange', schedule);
  mobile.addEventListener('change', () => { selection(selected); size(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; pauseState(); if (!reduced.matches) start(); schedule(); render(performance.now()); });
  // HTML remains usable if WebGL is unavailable; its carousel uses a low-frequency timer.
  setInterval(() => { if (!renderer && visible && !document.hidden && !paused && !dialog.open && performance.now() >= nextSlide) { selection(selected + 1); nextSlide = performance.now() + 6000; } }, 1000);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); root.dataset.renderer = 'fallback'; if (frameId) cancelAnimationFrame(frameId); frameId = null; renderer = null; });
  selection(0); pauseState();
}
