import { createNotice, renderNotice, startNotice, stopNotice, normalizeNoticeDesign } from './broadcast-notice.js';
import { currentConsoleSelection } from './selection.js';
(() => {
  const $ = id => document.getElementById(id);
  let csrf = '', snapshot, selected = [], noticeItems = [], editing = false, polling, activeNotice = 0;
  const previewStage = $('notice-preview-stage');
  const previewView = createNotice(previewStage, { onClose: () => { stopNotice(previewView); previewView.card.hidden = true; }, onImage: src => { $('preview-full-image').src = src; $('preview-viewer').hidden = false; } });
  const errors = { login_required: 'سجل الدخول أولاً.', invalid_login: 'بيانات الدخول غير صحيحة.', too_many_attempts: 'محاولات كثيرة. حاول بعد 15 دقيقة.', no_free_provider: 'هذه المباراة لا تملك مورداً مستقلاً ولا يوجد مورد فارغ. لم تتغير القناة.', channel_not_found: 'لم يعثر المورد على الاسم المحدد. لم تتغير القناة.', channel_probe_failed: 'فشل اختبار فيديو القناة الجديدة. أُعيدت القناة القديمة.', operation_in_progress: 'هناك عملية قيد التنفيذ.', operation_failed: 'تعذر إكمال العملية. راجع حالة الموارد قبل إعادة المحاولة.', invalid_image: 'الصورة غير صالحة أو كبيرة جداً.' };
  const phaseNames = { preparing: 'تحضير', discovering: 'بحث لدى المورد', testing_media: 'اختبار الفيديو', saving: 'حفظ القناة', assigning: 'توزيع وتجهيز الموارد', ready: 'اكتملت العملية' };
  Object.assign(errors, { invalid_notices: 'إعدادات الإشعارات غير صالحة. تحقق من عدد الدورات والمدة والفاصل وجهة العرض.', invalid_notice: 'محتوى أحد الإشعارات غير صالح. تحقق من العنوان والتعليق والصورة والمدة.', invalid_notice_design: 'أحد إعدادات تنسيق الإعلان خارج النطاق المسموح.' });
  function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
  async function api(path, body) {
    const response = await fetch(`/api/operator/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Operator-CSRF': csrf }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) { if (response.status === 401) loggedOut(); throw new Error(errors[data.error] || data.error || 'تعذر الاتصال'); }
    if (data.csrf) csrf = data.csrf;
    return data;
  }
  function button(icon, title, action) {
    const node = document.createElement('button'); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
    const image = document.createElement('img'); image.src = `/api/operator/ui/icons/${icon}`; image.alt = ''; node.append(image); node.onclick = action; return node;
  }
  function loggedOut() { $('login').hidden = false; $('workspace').hidden = true; $('refresh').hidden = true; $('logout').hidden = true; clearInterval(polling); }
  function renderSelected() {
    $('selected-count').textContent = `${selected.length} / 8`;
    $('selected-list').replaceChildren(...selected.map((id, index) => {
      const match = snapshot.matches.find(row => row.matchId === id);
      const row = document.createElement('div'); row.className = 'selected-item';
      const name = document.createElement('span'); name.textContent = `${index + 1}. ${match?.homeTeam || ''} - ${match?.awayTeam || ''}`; row.append(name);
      for (const [step, icon, label] of [[-1, 'arrow-up', 'تقديم'], [1, 'arrow-down', 'تأخير']]) row.append(button(icon, label, () => { const target = index + step; if (target < 0 || target >= selected.length) return; [selected[index], selected[target]] = [selected[target], selected[index]]; $('manual-enabled').checked = true; editing = true; renderMatches(); }));
      row.append(button('x', 'إزالة', () => { selected = selected.filter(value => value !== id); $('manual-enabled').checked = true; editing = true; renderMatches(); })); return row;
    }));
  }
  function renderMatches() {
    renderSelected();
    const query = $('search').value.trim().toLowerCase(), filter = $('status-filter').value;
    const matches = snapshot.matches.filter(row => `${row.homeTeam} ${row.awayTeam} ${row.league}`.toLowerCase().includes(query)
      && (filter !== 'live' || row.isLive) && (filter !== 'assigned' || row.viewingMode === 'stream'));
    $('match-list').replaceChildren(...matches.map(match => {
      const row = document.createElement('div'); row.className = 'match-row'; row.dataset.match = match.matchId;
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.includes(match.matchId); check.setAttribute('aria-label', `${match.homeTeam} - ${match.awayTeam}`);
      check.onchange = () => { if (check.checked && selected.length === 8) { check.checked = false; return message('الحد الأقصى ثماني مباريات.', true); } selected = check.checked ? [...selected, match.matchId] : selected.filter(id => id !== match.matchId); $('manual-enabled').checked = true; editing = true; renderSelected(); };
      const name = document.createElement('div'); name.className = 'match-name'; name.textContent = `${match.homeTeam} - ${match.awayTeam}`;
      const meta = document.createElement('small'); meta.textContent = `${match.league} · ${match.time || ''} · ${match.score}`; name.append(meta);
      const state = document.createElement('span'); state.className = `badge ${match.isLive ? 'live' : ''} ${match.sourceReady ? 'ready' : ''}`;
      state.textContent = `${match.isLive ? 'مباشر' : match.status} · ${match.sourceReady ? 'جاهز' : 'غير جاهز'}`;
      const input = document.createElement('input'); input.setAttribute('list', 'channel-names'); input.value = match.channelName || ''; input.setAttribute('aria-label', 'القناة'); input.oninput = () => { editing = true; };
      const save = button('radio', 'اختبار واعتماد القناة', async () => { save.disabled = true; try { await api('channel', { matchId: match.matchId, channel: input.value }); message('بدأ البحث والاختبار. عند امتلاء الموارد قد يتوقف بث هذه المباراة مؤقتاً أثناء اختبار القناة؛ بقية المباريات لا تتأثر.'); await refresh(false); } catch (error) { message(error.message, true); } finally { save.disabled = false; } });
      save.className = 'channel-save'; save.append(document.createTextNode('اختبار واعتماد'));
      row.append(check, name, state, input, save); return row;
    }));
  }
  function renderJobs() {
    $('jobs').replaceChildren(...snapshot.jobs.slice().reverse().map(job => { const row = document.createElement('div'); row.className = `job ${job.state === 'failed' ? 'error' : ''}`; row.textContent = `${job.state === 'failed' ? errors[job.error] || 'تعذر الإكمال' : phaseNames[job.phase] || job.phase}${job.channel ? ` · ${job.channel}` : ''}`; return row; }));
    const running = snapshot.jobs.some(job => job.state === 'running');
    $('save-selection').disabled = running;
    $('resource-count').textContent = `${snapshot.status.prewarm.warmed} روابط جاهزة / 8`;
  }
  async function refresh(render = true) {
    snapshot = await api('state');
    if (render) {
      const selection = currentConsoleSelection(snapshot);
      selected = selection.matches;
      $('manual-enabled').checked = selection.enabled;
      $('channel-names').replaceChildren(...snapshot.channels.map(channel => { const option = document.createElement('option'); option.value = channel.name; return option; }));
      $('servers').replaceChildren(...snapshot.status.accounts.map(account => { const node = document.createElement('span'); node.className = `server ${/STOPPED|UNAVAILABLE|COOLDOWN|STALLED/.test(account.status) ? 'bad' : ''}`; node.textContent = `${account.provider} · ${account.status}${account.current_channel ? ` · ${account.current_channel}` : ''}`; return node; }));
      noticeItems = (snapshot.state.notices.items || []).map(item => ({ title: item.title || '', text: item.text, image: item.image, duration: item.duration ?? null, design: normalizeNoticeDesign(item.design) }));
      if (!noticeItems.length) noticeItems = [newNotice()];
      for (const key of ['repeats', 'duration', 'interval']) $(`notice-${key}`).value = snapshot.state.notices[key];
      $('notice-target').value = snapshot.state.notices.matchIds.length ? 'selected' : 'all';
      renderMatches(); renderNotices(); editing = false;
    }
    const available = new Set(snapshot.matches.map(match => match.matchId));
    const current = selected.filter(id => available.has(id));
    if (current.length !== selected.length) { selected = current; renderSelected(); }
    for (const row of document.querySelectorAll('.match-row')) {
      const match = snapshot.matches.find(match => match.matchId === row.dataset.match);
      if (match) { const badge = row.querySelector('.badge'); badge.textContent = `${match.isLive ? 'مباشر' : match.status} · ${match.sourceReady ? 'جاهز' : 'غير جاهز'}`; badge.classList.toggle('ready', match.sourceReady); }
    }
    renderJobs();
  }
  function newNotice() { return { title: '', text: '', image: '', duration: null, design: normalizeNoticeDesign() }; }
  function preview(item) { $('preview-viewer').hidden = true; renderNotice(previewView, item); previewView.card.style.transform = `translateX(${(previewStage.clientWidth - previewView.card.offsetWidth) / 2}px)`; }
  $('preview-motion').onclick = () => { const item = noticeItems[activeNotice]; if (!item) return; preview(item); startNotice(previewView, item.duration || Number($('notice-duration').value), () => { previewView.card.hidden = true; }); };
  $('preview-dismiss').onclick = () => { $('preview-viewer').hidden = true; };
  async function compressImage(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error('اختر صورة PNG أو JPEG أو WebP أصغر من 5 ميغابايت.');
    const bitmap = await createImageBitmap(file); const ratio = Math.min(1, 960 / bitmap.width, 960 / bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    let encoded;
    for (const quality of [.9, .8, .65, .5]) { encoded = canvas.toDataURL('image/jpeg', quality); if (encoded.length < 235000) return encoded; }
    throw new Error('الصورة تحتوي تفاصيل كثيرة. اختر صورة أصغر.');
  }
  function renderNotices() {
    activeNotice = Math.min(activeNotice, Math.max(0, noticeItems.length - 1));
    $('notice-list').replaceChildren(...noticeItems.map((item, index) => {
      item.design = normalizeNoticeDesign(item.design);
      const row = document.createElement('div'); row.className = 'notice-editor'; row.dataset.notice = index;
      const update = () => { activeNotice = index; editing = true; preview(item); };
      const heading = document.createElement('div'); heading.className = 'notice-editor-heading';
      const name = document.createElement('strong'); name.textContent = `الإعلان ${index + 1}`; heading.append(name);
      heading.append(button('eye', 'معاينة الإعلان', () => { activeNotice = index; preview(item); previewStage.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
      for (const [step, icon, label] of [[-1, 'arrow-up', 'تقديم الإعلان'], [1, 'arrow-down', 'تأخير الإعلان']]) { const move = button(icon, label, () => { const target = index + step; [noticeItems[index], noticeItems[target]] = [noticeItems[target], noticeItems[index]]; activeNotice = target; editing = true; renderNotices(); }); move.disabled = index + step < 0 || index + step >= noticeItems.length; heading.append(move); }
      heading.append(button('trash-2', 'حذف الإعلان', () => { noticeItems.splice(index, 1); editing = true; renderNotices(); })); row.append(heading);
      const content = document.createElement('div'); content.className = 'notice-content-editor';
      const copy = document.createElement('div'); copy.className = 'notice-copy-editor';
      const title = document.createElement('input'); title.maxLength = 100; title.value = item.title || ''; title.placeholder = 'العنوان'; title.dataset.field = 'title'; title.oninput = () => { item.title = title.value; update(); };
      const text = document.createElement('textarea'); text.maxLength = 240; text.value = item.text; text.placeholder = 'التعليق'; text.dataset.field = 'text'; text.oninput = () => { item.text = text.value; update(); };
      copy.append(field('العنوان', title), field('التعليق', text)); content.append(copy);
      const picker = document.createElement('label'); picker.className = 'image-picker'; picker.append(document.createTextNode('صورة الإعلان'));
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp';
      file.onchange = async () => { if (!file.files[0]) return; try { const result = await api('image', { image: await compressImage(file.files[0]) }); item.image = result.image; activeNotice = index; editing = true; renderNotices(); } catch (error) { message(error.message, true); } };
      picker.append(file); if (item.image) { const image = document.createElement('img'); image.className = 'editor-image'; image.src = item.image; image.alt = ''; picker.append(image); picker.append(button('x', 'إزالة الصورة', () => { item.image = ''; activeNotice = index; editing = true; renderNotices(); })); }
      content.append(picker); row.append(content);
      const animations = [['none', 'بدون'], ['fade', 'تلاشي'], ['rise', 'ارتفاع'], ['pulse', 'نبض'], ['glow', 'توهج']];
      const alignments = [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']];
      function control(key, label, type, options) {
        const node = document.createElement(type === 'select' ? 'select' : 'input'); node.dataset.field = key;
        if (type === 'select') for (const [value, name] of options) { const option = document.createElement('option'); option.value = value; option.textContent = name; node.append(option); }
        else { node.type = type; if (options) [node.min, node.max] = options; }
        if (type === 'checkbox') node.checked = item.design[key]; else node.value = item.design[key];
        const wrapper = field(label, node); const output = type === 'range' ? document.createElement('output') : null;
        if (output) { output.textContent = node.value; wrapper.append(output); }
        node.oninput = () => { item.design[key] = type === 'checkbox' ? node.checked : ['range', 'number'].includes(type) ? Number(node.value) : node.value; if (output) output.textContent = node.value; update(); };
        return wrapper;
      }
      for (const [prefix, label, min, max] of [['title', 'تنسيق العنوان', 14, 44], ['text', 'تنسيق التعليق', 12, 32]]) {
        const group = document.createElement('fieldset'); group.className = 'notice-format-fields'; const legend = document.createElement('legend'); legend.textContent = label; group.append(legend);
        group.append(control(`${prefix}Size`, 'حجم الخط', 'range', [min, max]), control(`${prefix}Color`, 'اللون', 'color'), control(`${prefix}Animation`, 'حركة النص', 'select', animations), control(`${prefix}AnimationSeconds`, 'دورة حركة النص (ثوان)', 'range', [1, 8]), control(`${prefix}Align`, 'المحاذاة', 'select', alignments), control(`${prefix}Bold`, 'خط عريض', 'checkbox')); row.append(group);
      }
      const group = document.createElement('fieldset'); group.className = 'notice-format-fields notice-layout-fields'; const legend = document.createElement('legend'); legend.textContent = 'الموضع والخلفية والعبور'; group.append(legend);
      const duration = document.createElement('input'); duration.type = 'number'; duration.min = 5; duration.max = 120; duration.value = item.duration ?? ''; duration.placeholder = $('notice-duration').value; duration.dataset.field = 'duration'; duration.oninput = () => { item.duration = duration.value === '' ? null : Number(duration.value); update(); };
      group.append(field('مدة عبور الإعلان (ثوان)', duration), control('placement', 'موضع الإعلان', 'select', [['top', 'أعلى'], ['middle', 'وسط'], ['bottom', 'أسفل']]), control('titlePosition', 'مكان العنوان', 'select', [['above', 'فوق التعليق'], ['below', 'تحت التعليق']]), control('imageSide', 'مكان الصورة', 'select', [['right', 'يمين'], ['left', 'يسار']]), control('imageSize', 'حجم الصورة', 'range', [48, 160]), control('width', 'عرض الإعلان %', 'range', [35, 94]), control('cardScale', 'حجم البطاقة بالكامل %', 'range', [50, 150]), control('minHeight', 'الارتفاع الأدنى (0 تلقائي)', 'range', [0, 220]), control('padding', 'المسافة الداخلية', 'range', [0, 24]), control('backgroundOpacity', 'عتامة الخلفية %', 'range', [0, 100]), control('backgroundColor', 'لون الخلفية', 'color')); row.append(group); return row;
    }));
    preview(noticeItems[activeNotice] || newNotice()); $('add-notice').disabled = noticeItems.length >= 10;
  }
  function field(label, node) { const wrapper = document.createElement('label'); wrapper.className = 'notice-field'; const caption = document.createElement('span'); caption.textContent = label; wrapper.append(caption, node); return wrapper; }
  function validateNoticeInputs() {
    for (const input of document.querySelectorAll('#notices-view input[type="number"]')) {
      if (input.checkValidity()) continue;
      const label = input.closest('label');
      const name = label?.querySelector('span')?.textContent || label?.firstChild?.textContent || 'القيمة';
      input.focus(); input.reportValidity();
      throw new Error(`${name.trim()} يجب أن يكون عدداً صحيحاً بين ${input.min} و${input.max}.`);
    }
  }
  $('login').onsubmit = async event => { event.preventDefault(); try { await api('login', { username: $('username').value, password: $('password').value }); $('password').value = ''; await open(); } catch (error) { message(error.message, true); } };
  async function open() { await refresh(); $('login').hidden = true; $('workspace').hidden = false; $('refresh').hidden = false; $('logout').hidden = false; message(''); clearInterval(polling); polling = setInterval(() => refresh(false).catch(error => message(error.message, true)), 3000); }
  $('logout').onclick = async () => { await api('logout', {}); loggedOut(); };
  $('refresh').onclick = () => { if (!editing || confirm('توجد تغييرات غير محفوظة. تحديث القائمة؟')) refresh().catch(error => message(error.message, true)); };
  $('search').oninput = renderMatches; $('status-filter').onchange = renderMatches;
  $('manual-enabled').onchange = () => { editing = true; };
  document.querySelectorAll('.notice-settings input, .notice-settings select').forEach(input => { input.oninput = () => { editing = true; }; });
  $('save-selection').onclick = async () => { try { await api('selection', { enabled: $('manual-enabled').checked, matches: selected }); editing = false; message('بدأ تجهيز الاختيار في الخلفية المشتركة.'); await refresh(false); } catch (error) { message(error.message, true); } };
  $('add-notice').onclick = () => { if (noticeItems.length < 10) { noticeItems.push(newNotice()); activeNotice = noticeItems.length - 1; editing = true; } renderNotices(); };
  $('publish-notices').onclick = async () => { const button = $('publish-notices'); try { validateNoticeInputs(); button.disabled = true; await api('notices', { enabled: true, items: noticeItems, repeats: Number($('notice-repeats').value), duration: Number($('notice-duration').value), interval: Number($('notice-interval').value), matchIds: $('notice-target').value === 'selected' ? selected : [] }); message('تم نشر الإشعارات إلى المشغلات المفتوحة والـ embed.'); editing = false; } catch (error) { message(error.message, true); } finally { button.disabled = false; } };
  $('stop-notices').onclick = async () => { try { await api('notices/stop', {}); message('تم إيقاف الإشعارات فوراً.'); } catch (error) { message(error.message, true); } };
  document.querySelectorAll('nav button').forEach(node => { node.onclick = () => { document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button === node)); for (const id of ['matches-view', 'notices-view']) $(id).hidden = id !== node.dataset.view; if (node.dataset.view === 'notices-view') preview(noticeItems[activeNotice] || newNotice()); else stopNotice(previewView); }; });
  open().catch(() => loggedOut());
})();
