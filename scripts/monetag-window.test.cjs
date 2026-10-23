const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname, '../assets/js/monetag-window.js'), 'utf8');
const provider = 'https://al5sm.com/tag.min.js';
const android = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0.0.0 Safari/537.36';
function harness(options = {}) {
  const events = new Map(), calls = [], timers = [], redirects = [], controls = [{ id: 'control' }];
  const storage = new Map(options.storage || []);
  const result = { location: { origin: 'https://publisher.test' }, document: { visibilityState: 'visible', hasFocus: () => true } };
  let state = { query: 'safe football search', tab: 'today' }, focused = true;
  const native = function (...args) { calls.push({ args, receiver: this }); if (options.throws) throw new Error('native open failed'); return options.blocked ? null : result; };
  const target = { addEventListener(type, fn) { const rows = events.get(type) || []; rows.push(fn); events.set(type, rows); },
    removeEventListener(type, fn) { events.set(type, (events.get(type) || []).filter(row => row !== fn)); } };
  class Node { appendChild(node) { return node; } }
  class Frame { constructor() { this.contentWindow = { open: native }; } getAttribute(name) { return name === 'src' ? 'about:blank' : null; } hasAttribute() { return false; } }
  const document = { ...target, currentScript: { dataset: { zones: '42', desktop: 'chrome-windows', mobileSwap: options.mobile ? 'android-chrome' : 'off', components: 'ui', ...options.config } },
    scripts: [{ src: provider, dataset: { zone: options.wrongZone ? '99' : '42' } }], readyState: 'complete', visibilityState: 'visible',
    querySelectorAll(selector) { return selector === 'video,audio' ? options.media ? [{ paused: false }] : [] : selector === 'input[type="file"]' ? options.file ? [{ files: [{}] }] : [] : controls; },
    querySelector() { return options.busy ? {} : null; }, hasFocus: () => focused };
  const win = { ...target, open: native, scrollX: 0, scrollY: 120, opener: options.opener || null,
    focus() { calls.push({ focus: true }); }, scrollTo(x, y) { win.scrollX = x; win.scrollY = y; }, dispatchEvent() {} };
  win.top = options.embedded ? {} : win;
  const location = new URL(options.url || 'https://publisher.test/news.html?keep=yes#original');
  location.replace = url => redirects.push(url);
  const context = vm.createContext({ window: win, document, location, navigator: { userAgent: options.ua || (options.mobile ? android : desktop), userActivation: { isActive: true } },
    Node, HTMLIFrameElement: Frame, URL, URLSearchParams, crypto: webcrypto, CustomEvent: class {},
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}, queueMicrotask,
    requestAnimationFrame: fn => fn(), history: { state: null, replaceState(_, __, url) { context.historyUrl = url; } },
    sessionStorage: { getItem: key => storage.get(key) || null, setItem(key, value) { if (options.storageFailure) throw new Error('denied'); storage.set(key, value); }, removeItem: key => storage.delete(key) } });
  vm.runInContext(code, context, { filename: 'https://publisher.test/assets/js/monetag-window.js' });
  const emit = (type, event) => { for (const fn of [...events.get(type) || []]) fn(event); };
  const register = () => win.PublisherAdWindow.register('ui', { capture: () => state, restore: saved => { if (options.restoreFailure) return false; state = saved; return true; } });
  if (!options.notReady) register();
  const click = (extra = {}) => emit('click', { isTrusted: true, target: { closest: () => null }, ...extra });
  click();
  return { context, win, document, native, calls, result, timers, redirects, storage, events, emit, click, register, state: value => { state = value; }, focus: value => { focused = value; },
    run: (script, filename = provider) => vm.runInContext(script, context, { filename }) };
}
test('desktop temporary-iframe call preserves URL, target, receiver, security, native return and one focus request', () => {
  const h = harness();
  h.run(`var frame=new HTMLIFrameElement();new Node().appendChild(frame);var returned=frame.contentWindow.open.call(window,'https://ad.example/path?keep=1','adTarget','noopener,noreferrer,width=900,height=700,resizable=yes')`);
  assert.equal(h.context.returned, h.result);
  assert.equal(h.calls[0].receiver, h.win);
  assert.deepEqual(Array.from(h.calls[0].args.slice(0, 2)), ['https://ad.example/path?keep=1', 'adTarget']);
  assert.match(h.calls[0].args[2], /noopener,noreferrer/);
  assert.match(h.calls[0].args[2], /popup=yes,width=640,height=480/);
  h.emit('blur'); h.emit('blur');
  assert.equal(h.calls.filter(call => call.focus).length, 1);
  assert.ok(h.timers.some(timer => timer.delay === 250));
});
test('expired blur listener, blocked popup and thrown native calls cannot retry or steal focus later', () => {
  const h = harness(); h.run(`window.open('https://ad.example/','_blank','')`);
  h.timers.find(timer => timer.delay === 250).fn(); h.emit('blur');
  assert.equal(h.calls.length, 1);
  const blocked = harness({ blocked: true }); blocked.run(`var returned=window.open('https://ad.example/','_blank','')`);
  blocked.emit('blur'); assert.equal(blocked.context.returned, null); assert.equal(blocked.calls.length, 1);
  const failed = harness({ throws: true }); assert.throws(() => failed.run(`window.open('https://ad.example/','_blank','')`));
  failed.emit('blur'); assert.equal(failed.calls.length, 1);
});
test('unrelated scripts, wrong zones, services, media, unsafe URLs and same-tab targets stay unchanged', () => {
  const h = harness();
  for (const [url, target, source] of [
    ['https://ad.example/', '_blank', 'https://other-network.example/tag.js'],
    ['https://publisher.test/service', '_blank', provider], ['https://cdn.example/video.m3u8', '_blank', provider],
    ['javascript:void(0)', '_blank', provider], ['https://ad.example/', '_self', provider]
  ]) {
    h.run(`window.open(${JSON.stringify(url)},${JSON.stringify(target)},'noopener')`, source);
    assert.deepEqual(Array.from(h.calls.at(-1).args), [url, target, 'noopener']);
  }
  const wrong = harness({ wrongZone: true }); wrong.run(`window.open('https://ad.example/','_blank','')`);
  assert.equal(wrong.calls[0].args[2], '');
  h.run('var frame=new HTMLIFrameElement();new Node().appendChild(frame)', 'https://service.example/app.js');
  assert.equal(h.context.frame.contentWindow.open, h.native);
});
test('onClickExcludes uses DOM controls and direct calls are limited to the configured original URL', () => {
  const h = harness({ config: { directUrl: 'https://omg10.com/4/42' } });
  assert.equal(h.win.onClickExcludes[0].id, 'control');
  h.win.PublisherAdWindow.openDirect('https://omg10.com/4/42', '_blank', 'noopener,noreferrer');
  assert.match(h.calls[0].args[2], /noopener,noreferrer,popup=yes/);
  h.win.PublisherAdWindow.openDirect('https://service.example/', '_blank', 'noopener');
  assert.equal(h.calls[1].args[2], 'noopener');
});
test('unverified browsers and Android production opt-out keep the original ad path', () => {
  for (const ua of [android, desktop.replace('Chrome/155', 'Firefox/155'), desktop + ' Edg/155.0', android + ' EdgA/155', android + ' SamsungBrowser/28', android + '; wv Version/4.0', 'iPhone CriOS/155 Safari/604']) {
    const h = harness({ ua }); h.run(`window.open('https://ad.example/','_blank','')`);
    assert.equal(h.win.open, h.native, 'untested browser native method must not be wrapped');
    assert.equal(h.calls[0].args[0], 'https://ad.example/'); assert.equal(h.calls[0].args[2], '');
  }
});
test('Android handoff redirects only after origin, source, token, actual foreground and state checks', () => {
  const h = harness({ mobile: true }); h.run(`var returned=window.open('https://ad.example/path?q=original','_blank','')`);
  assert.equal(h.context.returned, h.win);
  assert.equal(new URL(h.calls[0].args[0]).origin, 'https://publisher.test');
  const saved = JSON.parse(h.storage.get('publisher.ad-handoff.v1'));
  assert.match(saved.token, /^[a-f0-9]{32}$/);
  const event = { origin: 'https://publisher.test', source: h.result, data: { type: 'publisher-ad-ready', token: saved.token, visible: true } };
  h.emit('message', { ...event, origin: 'https://evil.example' }); h.emit('message', { ...event, source: {} });
  h.emit('message', { ...event, data: { ...event.data, token: 'wrong' } }); assert.equal(h.redirects.length, 0);
  h.document.visibilityState = 'hidden'; h.emit('message', event);
  assert.deepEqual(h.redirects, ['https://ad.example/path?q=original']); assert.equal(h.win.opener, null);
  assert.equal(h.storage.size, 0); h.emit('message', event); assert.equal(h.redirects.length, 1);
});
test('Android cannot swap a player, embedded page, active media, upload, busy UI, unready components or protected navigation', () => {
  for (const options of [{ config: { mode: 'player' } }, { embedded: true }, { media: true }, { file: true }, { busy: true }, { notReady: true }]) {
    const h = harness({ mobile: true, ...options }); h.run(`window.open('https://ad.example/','_blank','')`);
    assert.equal(h.calls[0].args[0], 'https://ad.example/'); assert.equal(h.storage.size, 0);
  }
  const protectedPage = harness({ mobile: true }); protectedPage.click({ target: { closest: () => ({}) } });
  protectedPage.run(`window.open('https://ad.example/','_blank','')`); assert.equal(protectedPage.calls[0].args[0], 'https://ad.example/');
  for (const type of ['input', 'submit']) {
    const h = harness({ mobile: true }); h.emit(type, { target: { form: {} } }); h.run(`window.open('https://ad.example/','_blank','')`);
    assert.equal(h.calls[0].args[0], 'https://ad.example/');
  }
});
test('Android preserves security flags, never retries blocked opens and cannot navigate after timeout or changed state', () => {
  const secure = harness({ mobile: true }); secure.run(`window.open('https://ad.example/','_blank','noopener,noreferrer')`);
  assert.equal(secure.calls[0].args[2], 'noopener,noreferrer'); assert.equal(secure.storage.size, 0);
  const blocked = harness({ mobile: true, blocked: true }); blocked.run(`var returned=window.open('https://ad.example/','_blank','')`);
  assert.equal(blocked.context.returned, null); assert.equal(blocked.calls.length, 1); assert.equal(blocked.storage.size, 0);
  for (const expire of [true, false]) {
    const h = harness({ mobile: true }); h.run(`window.open('https://ad.example/','_blank','')`);
    const saved = JSON.parse(h.storage.get('publisher.ad-handoff.v1'));
    if (expire) h.timers.find(timer => timer.delay === 10000).fn(); else h.state({ changed: true });
    h.emit('message', { origin: 'https://publisher.test', source: h.result, data: { type: 'publisher-ad-ready', token: saved.token, visible: true } });
    assert.equal(h.redirects.length, 0); assert.equal(h.calls.length, 1);
  }
});
test('restoring the publisher copy waits for components, restores scroll and removes token/opener before acknowledgement', async () => {
  const parent = harness({ mobile: true }); parent.run(`window.open('https://ad.example/','_blank','')`);
  const resume = parent.calls[0].args[0], messages = [];
  const child = harness({ mobile: true, notReady: true, storage: parent.storage, url: resume,
    opener: { postMessage(data, origin) { messages.push({ data, origin }); } } });
  assert.equal(messages.length, 0); child.register();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.win.scrollY, 120); assert.equal(child.context.historyUrl, '/news.html?keep=yes#original');
  assert.equal(child.storage.size, 0); assert.equal(child.win.opener, null);
  assert.equal(messages[0].data.type, 'publisher-ad-ready'); assert.equal(messages[0].origin, 'https://publisher.test');
});
test('failed restoration, hidden copy and stale transfer cannot acknowledge or redirect', async () => {
  for (const failure of ['restore', 'hidden', 'stale']) {
    const parent = harness({ mobile: true }); parent.run(`window.open('https://ad.example/','_blank','')`);
    const data = new Map(parent.storage); const saved = JSON.parse(data.get('publisher.ad-handoff.v1'));
    if (failure === 'stale') { saved.created -= 20000; data.set('publisher.ad-handoff.v1', JSON.stringify(saved)); }
    const messages = [];
    const child = harness({ mobile: true, notReady: true, restoreFailure: failure === 'restore', storage: data,
      url: parent.calls[0].args[0], opener: { postMessage: message => messages.push(message) } });
    if (failure === 'hidden') child.document.visibilityState = 'hidden';
    child.register(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 0); assert.equal(child.redirects.length, 0); assert.equal(child.storage.size, 0);
  }
});
test('rollback restores native window and iframe insertion methods without changing unrelated wrappers', () => {
  const h = harness(); const originalAppend = h.context.Node.prototype.appendChild;
  h.win.PublisherAdWindow.dispose(); assert.equal(h.win.open, h.native); assert.notEqual(h.context.Node.prototype.appendChild, originalAppend);
});
