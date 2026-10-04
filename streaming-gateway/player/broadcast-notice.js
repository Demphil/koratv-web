export const noticeDefaults = Object.freeze({
  titleSize: 24, textSize: 16, titleColor: '#ffdc74', textColor: '#ffffff',
  titleAnimation: 'none', textAnimation: 'none', titleAnimationSeconds: 2, textAnimationSeconds: 2, titleAlign: 'right', textAlign: 'right',
  titlePosition: 'above', placement: 'bottom', imageSide: 'right', imageSize: 96,
  width: 74, cardScale: 100, minHeight: 0, padding: 10,
  backgroundColor: '#163c32', backgroundOpacity: 0, titleBold: true, textBold: false
});
const choices = { titleAnimation: ['none', 'fade', 'rise', 'pulse', 'glow'], textAnimation: ['none', 'fade', 'rise', 'pulse', 'glow'],
  titleAlign: ['right', 'center', 'left'], textAlign: ['right', 'center', 'left'], titlePosition: ['above', 'below'],
  placement: ['top', 'middle', 'bottom'], imageSide: ['right', 'left'] };
const ranges = { titleSize: [14, 44], textSize: [12, 32], titleAnimationSeconds: [1, 8], textAnimationSeconds: [1, 8], imageSize: [48, 160], width: [35, 94], cardScale: [50, 150], minHeight: [0, 220], padding: [0, 24], backgroundOpacity: [0, 100] };
export function normalizeNoticeDesign(input = {}, strict = false) {
  const design = { ...noticeDefaults };
  if (!input || typeof input !== 'object' || Array.isArray(input)) { if (strict) throw new Error('invalid_notice_design'); return design; }
  for (const key of Object.keys(design)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    const valid = choices[key] ? choices[key].includes(value) : ranges[key]
      ? Number.isInteger(value) && value >= ranges[key][0] && value <= ranges[key][1]
      : key.endsWith('Color') ? typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) : typeof value === 'boolean';
    if (!valid) { if (strict) throw new Error('invalid_notice_design'); continue; }
    design[key] = value;
  }
  return design;
}
export function createNotice(container, { onClose = () => {}, onImage = () => {} } = {}) {
  const card = document.createElement('aside'); card.className = 'broadcast-notice'; card.hidden = true;
  card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
  const media = document.createElement('button'); media.type = 'button'; media.className = 'notice-media'; media.hidden = true;
  media.setAttribute('aria-label', 'عرض صورة الإعلان بحجم أكبر'); media.title = 'تكبير الصورة';
  const image = document.createElement('img'); image.alt = 'صورة الإعلان'; media.append(image); media.onclick = () => onImage(image.src);
  const copy = document.createElement('div'); copy.className = 'notice-copy';
  const title = document.createElement('h3'); title.className = 'notice-title';
  const text = document.createElement('p'); text.className = 'notice-text'; copy.append(title, text);
  const close = document.createElement('button'); close.type = 'button'; close.className = 'notice-close'; close.textContent = '×';
  close.setAttribute('aria-label', 'إغلاق الإعلان'); close.onclick = onClose;
  card.append(media, copy, close); container.append(card);
  const view = { card, media, image, title, text, container, animations: [], design: { ...noticeDefaults }, motion: null };
  const reflow = () => {
    if (card.hidden) return;
    const previous = view.motion;
    if (previous) {
      const time = previous.animation.currentTime || 0, paused = previous.animation.playState === 'paused';
      const animation = startNotice(view, previous.seconds, previous.onFinish);
      if (animation) { animation.currentTime = time; if (paused) animation.pause(); }
    } else { fitNotice(view); card.style.transform = `translateX(${(container.clientWidth - card.offsetWidth) / 2}px)`; }
  };
  image.onload = reflow;
  image.onerror = () => { media.hidden = true; reflow(); };
  const observer = new ResizeObserver(reflow); observer.observe(container);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches) { stopNotice(view); card.style.transform = `translateX(${(container.clientWidth - card.offsetWidth) / 2}px)`; } });
  return view;
}
export function stopNotice(view) { for (const animation of view.animations) animation.cancel(); view.animations = []; view.motion = null; }
export function renderNotice(view, item, imageOrigin = '') {
  stopNotice(view);
  const design = normalizeNoticeDesign(item.design); view.design = design;
  view.title.textContent = item.title || ''; view.title.hidden = !item.title;
  view.text.textContent = item.text || ''; view.text.hidden = !item.text;
  view.media.hidden = !item.image; if (item.image) view.image.src = imageOrigin + item.image;
  view.card.dataset.placement = design.placement; view.card.dataset.imageSide = design.imageSide;
  view.card.dataset.titlePosition = design.titlePosition; view.card.dataset.surface = design.backgroundOpacity ? 'glass' : 'clear';
  for (const [property, value] of Object.entries({ '--notice-title-size': `${design.titleSize}px`, '--notice-text-size': `${design.textSize}px`,
    '--notice-title-color': design.titleColor, '--notice-text-color': design.textColor, '--notice-image-size': `${design.imageSize}px`,
    '--notice-width': `${design.width}%`, '--notice-title-align': design.titleAlign, '--notice-text-align': design.textAlign,
    '--notice-title-weight': design.titleBold ? 700 : 400, '--notice-text-weight': design.textBold ? 700 : 400 })) view.card.style.setProperty(property, value);
  const rgb = design.backgroundColor.match(/[a-f0-9]{2}/gi).map(hex => parseInt(hex, 16));
  view.card.style.backgroundColor = `rgba(${rgb.join(',')},${design.backgroundOpacity / 100})`;
  view.card.style.transform = ''; view.card.hidden = false;
  fitNotice(view);
}
function fitNotice(view) {
  const budget = Math.max(64, view.container.clientHeight - 68);
  const scale = view.design.cardScale / 100 * Math.min(1, Math.max(.8, view.container.clientWidth / 760));
  const padding = Math.min(view.design.padding * scale, budget / 8);
  view.card.style.setProperty('--notice-width', `${Math.min(94, view.design.width * view.design.cardScale / 100)}%`);
  view.card.style.setProperty('--notice-padding', `${padding}px`);
  view.card.style.setProperty('--notice-gap', `${12 * scale}px`);
  view.card.style.setProperty('--notice-min-height', `${Math.min(budget, view.design.minHeight * scale)}px`);
  const ratio = view.image.naturalWidth / view.image.naturalHeight || 1;
  const imageLimit = Math.min(view.design.imageSize * scale, budget - padding * 2 - 2, Math.max(24, view.card.clientWidth * .4));
  const mediaWidth = ratio >= 1 ? imageLimit : imageLimit * ratio;
  const mediaHeight = ratio >= 1 ? imageLimit / ratio : imageLimit;
  view.card.style.setProperty('--notice-media-width', `${mediaWidth}px`);
  view.card.style.setProperty('--notice-media-height', `${mediaHeight}px`);
  let titleSize = Math.max(11, Math.round(view.design.titleSize * scale)), textSize = Math.max(10, Math.round(view.design.textSize * scale));
  view.card.style.setProperty('--notice-title-size', `${titleSize}px`); view.card.style.setProperty('--notice-text-size', `${textSize}px`);
  for (let attempt = 0; attempt < 28 && view.card.offsetHeight > budget; attempt++) {
    if (titleSize <= 11 && textSize <= 10) break;
    titleSize = Math.max(11, titleSize - 1); textSize = Math.max(10, textSize - 1);
    view.card.style.setProperty('--notice-title-size', `${titleSize}px`); view.card.style.setProperty('--notice-text-size', `${textSize}px`);
  }
  view.card.style.setProperty('--notice-height', `${view.card.offsetHeight}px`);
}
const textFrames = {
  fade: [{ opacity: .3 }, { opacity: 1 }, { opacity: .3 }],
  rise: [{ transform: 'translateY(4px)', opacity: .7 }, { transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(4px)', opacity: .7 }],
  pulse: [{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }, { transform: 'scale(1)' }],
  glow: [{ textShadow: '0 1px 3px #000' }, { textShadow: '0 0 9px currentColor, 0 1px 3px #000' }, { textShadow: '0 1px 3px #000' }]
};
export function startNotice(view, seconds, onFinish = () => {}) {
  stopNotice(view); fitNotice(view);
  const duration = Math.max(5, Math.min(120, Number(seconds) || 10)) * 1000;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { view.card.style.transform = `translateX(${(view.container.clientWidth - view.card.offsetWidth) / 2}px)`; return null; }
  // A constant-speed full traversal: neither entrance nor center has a hold.
  const animation = view.card.animate([{ transform: `translateX(${view.container.clientWidth + 2}px)` }, { transform: `translateX(${-view.card.offsetWidth - 2}px)` }], { duration, easing: 'linear', fill: 'both' });
  animation.onfinish = onFinish; view.animations.push(animation); view.motion = { animation, seconds: duration / 1000, onFinish };
  for (const [element, name, seconds] of [[view.title, view.design.titleAnimation, view.design.titleAnimationSeconds], [view.text, view.design.textAnimation, view.design.textAnimationSeconds]]) {
    if (!element.hidden && textFrames[name]) view.animations.push(element.animate(textFrames[name], { duration: seconds * 1000, iterations: Infinity, easing: 'ease-in-out' }));
  }
  return animation;
}
