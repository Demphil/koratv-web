import { createNotice, renderNotice, startNotice, stopNotice, normalizeNoticeDesign } from './broadcast-notice.js';
import { currentConsoleSelection } from './selection.js';
(() => {
  const $ = id => document.getElementById(id);
  let csrf = '', snapshot, selected = [], noticeItems = [], editing = false, polling, activeNotice = 0, importJob = '', searchJob = '', refreshing;
  const previewStage = $('notice-preview-stage');
  let channelSearchTimer, channelSearchVersion = 0, transportFailure = false, loggingIn = false;
  const pendingRequests = new Map(), rowJobs = new Map();
  const active = job => ['queued', 'running'].includes(job.state);
  const ended = match => /^(RESULT|FINISHED|ENDED|FT|AET|PEN|انتهت)$/i.test(match.status || '');
  const renewableIds = () => selected.filter(id => snapshot.matches.some(match => match.matchId === id && !ended(match) && match.channelName));
  const badgeText = match => ended(match) ? 'انتهت' : `${match.isLive ? 'مباشر' : /^(FIXTURE|NS|TBD)$/i.test(match.status || '') ? 'لم تبدأ' : match.status} · ${match.sourceReady ? 'جاهز' : 'غير جاهز'}`;
  const matchLabel = id => { const row = snapshot.matches.find(item => item.matchId === id); return row ? `${row.homeTeam} - ${row.awayTeam}` : id; };
  async function submitJob(path, body) {
    const key = `${path}:${JSON.stringify(body)}`;
    if (!pendingRequests.has(key)) pendingRequests.set(key, crypto.randomUUID());
    const result = await api(path, { ...body, requestId: pendingRequests.get(key) });
    pendingRequests.delete(key);
    return result;
  }
  function suggestChannels(value) {
    clearTimeout(channelSearchTimer);
    const version = ++channelSearchVersion;
    if (value.trim().length < 2) return;
    channelSearchTimer = setTimeout(async () => {
      try {
        const data = await api(`channels?query=${encodeURIComponent(value.trim())}`);
        if (version !== channelSearchVersion) return;
        $('channel-names').replaceChildren(...data.channels.map(channel => { const option = document.createElement('option'); option.value = channel.name; return option; }));
      } catch { /* Keep the typed channel and existing suggestions on a transient failure. */ }
    }, 350);
  }
  const previewView = createNotice(previewStage, { onClose: () => { stopNotice(previewView); previewView.card.hidden = true; }, onImage: src => { $('preview-full-image').src = src; $('preview-viewer').hidden = false; } });
  const errors = { login_required: 'سجل الدخول أولاً.', invalid_login: 'بيانات الدخول غير صحيحة.', too_many_attempts: 'محاولات كثيرة. حاول بعد 15 دقيقة.', no_free_provider: 'هذه المباراة لا تملك مورداً مستقلاً ولا يوجد مورد فارغ. لم تتغير القناة.', channel_not_found: 'لم يعثر المورد على الاسم المحدد. لم تتغير القناة.', channel_probe_failed: 'فشل اختبار فيديو القناة الجديدة. أُعيدت القناة القديمة.', operation_in_progress: 'هناك عملية قيد التنفيذ.', operation_failed: 'تعذر إكمال العملية. راجع حالة الموارد قبل إعادة المحاولة.', invalid_image: 'الصورة غير صالحة أو كبيرة جداً.' };
  const phaseNames = { preparing: 'تحضير', discovering: 'بحث لدى المورد', testing_media: 'اختبار الفيديو', saving: 'حفظ القناة', assigning: 'توزيع وتجهيز الموارد', ready: 'اكتملت العملية' };
  Object.assign(errors, { invalid_notices: 'إعدادات الإشعارات غير صالحة. تحقق من عدد الدورات والمدة والفاصل وجهة العرض.', invalid_notice: 'محتوى أحد الإشعارات غير صالح. تحقق من العنوان والتعليق والصورة والمدة.', invalid_notice_design: 'أحد إعدادات تنسيق الإعلان خارج النطاق المسموح.' });
  Object.assign(errors, { invalid_team_names: 'أدخل اسمين مختلفين للفريقين، من حرفين إلى 80 حرفاً.', source_search_failed: 'تعذر الاتصال بـ Kooora. لم تُضف مباراة غير مؤكدة.', search_expired: 'انتهت صلاحية نتائج البحث. ابحث مجدداً.', match_not_found: 'لم تعد المباراة موجودة بالهوية نفسها في Kooora.', match_not_broadcastable: 'المباراة ملغاة أو مؤجلة؛ لا يمكن إضافتها.', search_rate_limited: 'بلغت حد البحث لهذه الساعة. حاول لاحقاً.' });
  errors.login_in_progress = 'يجري التحقق من الدخول. انتظر لحظة ثم حاول مجدداً.';
  phaseNames.searching_match = 'تأكيد المباراة والقنوات من Kooora';
  phaseNames.queued = 'في طابور التنفيذ';
  Object.assign(errors, { provider_busy: 'المورد مشغول بمباراة أخرى. لم يتغير بثها.', provider_reserved: 'المورد محجوز لمباراة أخرى. اختر مورداً آخر.', provider_unavailable: 'المورد قيد اختبار آخر. حاول لاحقاً.', invalid_provider: 'اختر مورداً مفعلاً من القائمة.', queue_full: 'طابور العمليات ممتلئ. انتظر اكتمال العمليات الحالية.', invalid_channel: 'حدد اسم قناة صالحاً أولاً.' });
  errors.channel_not_found = 'لم يعثر المورد على قناة تطابق هذا الاسم. اختر قناة من قائمة Kooora الخاصة بالمباراة؛ أسماء المنصات مثل MBC Shahid ليست بديلاً عن اسم قناة محددة. لم تتغير القناة المعتمدة.';
  function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
  async function api(path, body) {
    let response;
    try { response = await fetch(`/api/operator/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Operator-CSRF': csrf }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(25000) }); }
    catch { transportFailure = true; throw new Error('انقطع الاتصال مؤقتاً. لم تُمسح اختياراتك. سنعيد متابعة الحالة تلقائياً.'); }
    const data = await response.json().catch(() => null);
    if (response.status >= 500) { transportFailure = true; throw new Error('الخادم غير متاح مؤقتاً. اختياراتك لم تتغير؛ سيُعاد الاتصال تلقائياً.'); }
    if (!data || typeof data !== 'object') { transportFailure = true; throw new Error('لم تصل استجابة كاملة من الخادم. لم تتغير اختياراتك.'); }
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
    $('renew-selected').disabled = !renewableIds().length || snapshot.jobs.some(job => active(job) && job.kind !== 'match_search');
    $('selected-list').replaceChildren(...selected.map((id, index) => {
      const match = snapshot.matches.find(row => row.matchId === id);
      const row = document.createElement('div'); row.className = 'selected-item';
      const name = document.createElement('span'); name.textContent = `${index + 1}. ${match?.homeTeam || ''} - ${match?.awayTeam || ''}`; row.append(name);
      for (const [step, icon, label] of [[-1, 'arrow-up', 'تقديم'], [1, 'arrow-down', 'تأخير']]) row.append(button(icon, label, () => { const target = index + step; if (target < 0 || target >= selected.length) return; [selected[index], selected[target]] = [selected[target], selected[index]]; $('manual-enabled').checked = true; editing = true; renderMatches(); }));
      row.append(button('x', 'إزالة', () => { selected = selected.filter(value => value !== id); $('manual-enabled').checked = true; editing = true; renderMatches(); })); return row;
    }));
  }
  function renderMatches() {
    const providerDrafts = new Map([...document.querySelectorAll('.provider-select')].filter(input => input.dataset.dirty === 'true').map(input => [input.closest('.match-row').dataset.match, input.value]));
    const channelDrafts = new Map([...document.querySelectorAll('.match-row')].map(row => [row.dataset.match, row.querySelector('input[list]')])
      .filter(([, input]) => input?.dataset.dirty === 'true').map(([id, input]) => [id, input.value]));
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
      state.textContent = badgeText(match);
      const input = document.createElement('input'); input.setAttribute('list', 'channel-names'); input.value = match.channelName || ''; input.setAttribute('aria-label', 'القناة'); input.oninput = () => { input.dataset.dirty = 'true'; editing = true; suggestChannels(input.value); };
      if (channelDrafts.has(match.matchId)) { input.value = channelDrafts.get(match.matchId); input.dataset.dirty = 'true'; }
      const channelEditor = document.createElement('div'); channelEditor.className = 'channel-editor';
      const broadcasts = document.createElement('select'); broadcasts.setAttribute('aria-label', 'قنوات Kooora الناقلة لهذه المباراة');
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'قنوات Kooora'; broadcasts.append(placeholder);
      for (const channel of match.broadcastChannels || []) { const option = document.createElement('option'); option.value = channel; option.textContent = channel; broadcasts.append(option); }
      broadcasts.value = (match.broadcastChannels || []).includes(input.value) ? input.value : '';
      broadcasts.hidden = !(match.broadcastChannels || []).length;
      broadcasts.onchange = () => { if (!broadcasts.value) return; input.value = broadcasts.value; input.dataset.dirty = 'true'; editing = true; };
      channelEditor.append(broadcasts, input);
      const supplier = document.createElement('div'); supplier.className = 'provider-editor';
      const provider = document.createElement('select'); provider.className = 'provider-select'; provider.setAttribute('aria-label', 'المورد المحجوز');
      const automatic = document.createElement('option'); automatic.value = ''; automatic.textContent = 'تلقائي'; provider.append(automatic);
      for (const { id } of snapshot.providers || []) { const option = document.createElement('option'); option.value = id; option.textContent = `المورد ${id}`; provider.append(option); }
      provider.value = providerDrafts.get(match.matchId) ?? match.boundProvider ?? '';
      if (providerDrafts.has(match.matchId)) provider.dataset.dirty = 'true';
      provider.onchange = () => { provider.dataset.dirty = 'true'; editing = true; };
      const actual = document.createElement('small'); actual.className = 'provider-actual'; supplier.append(provider, actual);
      async function action(path, body, control) {
        control.disabled = true;
        try { const result = await submitJob(path, body); rowJobs.set(match.matchId, result.job.id); message('تمت إضافة العملية إلى الطابور. يجري اختبار الرابط قبل اعتماده.'); await refresh(false); }
        catch (error) { message(error.message, true); control.disabled = false; }
      }
      const save = button('radio', 'اختبار واعتماد القناة', () => action('channel', { matchId: match.matchId, channel: input.value }, save));
      save.className = 'channel-save'; save.append(document.createTextNode('اختبار واعتماد'));
      const pin = button('pin', 'حجز أو تغيير المورد', () => action('provider', { matchId: match.matchId, providerId: provider.value }, pin)); pin.append(document.createTextNode('حجز المورد'));
      const renew = button('refresh-cw', 'تجديد الرابط من المورد واختبار الفيديو', () => action('refresh-links', { matchId: match.matchId }, renew)); renew.append(document.createTextNode('تجديد الرابط'));
      const controls = document.createElement('div'); controls.className = 'match-actions'; controls.append(save, pin, renew);
      row.append(check, name, state, channelEditor, supplier, controls); return row;
    }));
    updateProviderStatus();
  }
  function updateProviderStatus() {
    $('servers').replaceChildren(...snapshot.status.accounts.map(account => { const node = document.createElement('span'); node.className = `server ${/STOPPED|UNAVAILABLE|COOLDOWN|STALLED/.test(account.status) ? 'bad' : ''}`; node.textContent = `${account.provider} · ${account.status}${account.current_channel ? ` · ${account.current_channel}` : ''}`; return node; }));
    for (const row of document.querySelectorAll('.match-row')) {
      const match = snapshot.matches.find(item => item.matchId === row.dataset.match); if (!match) continue;
      const account = snapshot.status.accounts.find(item => item.provider === match.assignedProvider);
      const actual = row.querySelector('.provider-actual');
      const checked = snapshot.state.providers?.[match.matchId]?.verifiedAt || account?.last_checked_at;
      const date = checked && new Date(checked);
      actual.textContent = `${match.assignedProvider ? `الفعلي: ${match.assignedProvider}` : 'لا يوجد مورد نشط'}${match.boundProvider ? ` · محجوز: ${match.boundProvider}` : ''}${date && !Number.isNaN(date.getTime()) ? ` · فحص ${date.toLocaleTimeString('ar', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit' })}` : ''}`;
      const select = row.querySelector('.provider-select');
      if (select.dataset.dirty !== 'true') select.value = match.boundProvider || '';
      for (const option of select.options) {
        if (!option.value) continue;
        const reserved = snapshot.matches.find(item => item.matchId !== match.matchId && item.boundProvider === option.value);
        const used = snapshot.status.accounts.find(item => item.provider === option.value)?.matchIds?.some(id => id !== match.matchId);
        option.disabled = Boolean(reserved || used);
        option.textContent = `المورد ${option.value}${reserved || used ? ' · مشغول' : ''}`;
      }
    }
  }
  function renderJobs() {
    $('jobs').replaceChildren(...snapshot.jobs.slice().reverse().map(job => {
      const row = document.createElement('div'); row.className = `job ${job.state === 'failed' ? 'error' : ''}`;
      row.textContent = `${job.matchId ? `${matchLabel(job.matchId)} · ` : ''}${job.state === 'failed' ? errors[job.error] || 'تعذر الإكمال' : job.displayOnly && job.state === 'complete' ? 'أُضيفت المباراة للعرض في الموقع' : phaseNames[job.phase] || job.phase}${job.channel ? ` · ${job.channel}` : ''}${job.total ? ` · ${job.completed || 0}/${job.total}` : ''}`;
      for (const item of job.results || []) { const result = document.createElement('div'); result.className = item.ok ? 'job-result' : 'job-result error'; result.textContent = `${matchLabel(item.matchId)}: ${item.ok ? `تم التجديد · ${item.provider || ''}` : errors[item.error] || 'تعذر التجديد'}`; row.append(result); }
      return row;
    }));
    const running = snapshot.jobs.some(job => active(job) && job.kind !== 'match_search');
    $('save-selection').disabled = running;
    $('renew-selected').disabled = running || !renewableIds().length;
    for (const row of document.querySelectorAll('.match-row')) {
      const currentJob = snapshot.jobs.find(job => active(job) && (job.kind === 'selection' || job.matchId === row.dataset.match || job.matchIds?.includes(row.dataset.match)));
      const busy = Boolean(currentJob);
      const match = snapshot.matches.find(item => item.matchId === row.dataset.match);
      for (const control of row.querySelectorAll('.match-actions button')) control.disabled = busy || match && ended(match);
      row.classList.toggle('busy', busy);
      if (currentJob) row.querySelector('.badge').textContent = phaseNames[currentJob.phase] || 'قيد التنفيذ';
    }
    for (const button of document.querySelectorAll('.import-match-button')) button.disabled = running || button.dataset.unavailable === 'true';
    $('resource-count').textContent = `${snapshot.status.prewarm.warmed} روابط جاهزة / 8`;
  }
  async function refresh(render = true) {
    if (refreshing) return refreshing;
    refreshing = refreshSnapshot(render).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function refreshSnapshot(render) {
    const next = await api('state');
    if (!Array.isArray(next.matches) || !Array.isArray(next.jobs) || !Array.isArray(next.channels) || !next.state?.selection || !next.status?.prewarm) throw new Error('لم تصل حالة كاملة من الخادم. بقيت اختياراتك محفوظة.');
    snapshot = next;
    if (transportFailure) { transportFailure = false; message('تم استعادة الاتصال.'); }
    const previousIds = [...document.querySelectorAll('.match-row')].map(row => row.dataset.match);
    if (searchJob) {
      const job = snapshot.jobs.find(job => job.id === searchJob);
      if (job && !active(job)) {
        if (job.state === 'complete') renderImportResults(job.result);
        else { $('import-search-status').textContent = errors[job.error] || 'تعذر البحث. حاول مجدداً.'; }
        searchJob = ''; $('import-search').disabled = false;
      } else if (!job) {
        searchJob = ''; $('import-search').disabled = false;
        $('import-search-status').textContent = 'أُعيد تشغيل الخدمة أثناء البحث. ابحث مجدداً؛ اختيارات البث لم تتغير.';
      }
    }
    const importedJob = snapshot.jobs.find(job => job.id === importJob);
    if (importedJob && !active(importedJob)) {
      renderMatches();
      importJob = '';
    }
    if (render) {
      const selection = currentConsoleSelection(snapshot);
      selected = selection.matches;
      $('manual-enabled').checked = selection.enabled;
      $('channel-names').replaceChildren(...snapshot.channels.map(channel => { const option = document.createElement('option'); option.value = channel.name; return option; }));
      noticeItems = (snapshot.state.notices.items || []).map(item => ({ title: item.title || '', text: item.text, image: item.image, duration: item.duration ?? null, design: normalizeNoticeDesign(item.design) }));
      if (!noticeItems.length) noticeItems = [newNotice()];
      for (const key of ['repeats', 'duration', 'interval']) $(`notice-${key}`).value = snapshot.state.notices[key];
      $('notice-target').value = snapshot.state.notices.matchIds.length ? 'selected' : 'all';
      renderMatches(); renderNotices(); editing = false;
    }
    if (!render && !$('search').value && $('status-filter').value === 'all' && previousIds.join('|') !== snapshot.matches.map(row => row.matchId).join('|') && !document.activeElement?.closest('.match-row')) renderMatches();
    const available = new Set(snapshot.matches.map(match => match.matchId));
    const current = selected.filter(id => available.has(id));
    if (current.length !== selected.length) { selected = current; renderSelected(); }
    for (const row of document.querySelectorAll('.match-row')) {
      const match = snapshot.matches.find(match => match.matchId === row.dataset.match);
      if (match) {
        const badge = row.querySelector('.badge'); badge.textContent = badgeText(match); badge.classList.toggle('ready', match.sourceReady);
        const input = row.querySelector('input[list]'), broadcasts = row.querySelector('.channel-editor select');
        const job = snapshot.jobs.find(job => job.id === rowJobs.get(match.matchId));
        if (job?.state === 'complete') { if (job.kind === 'channel') delete input.dataset.dirty; if (job.kind === 'provider') delete row.querySelector('.provider-select').dataset.dirty; rowJobs.delete(match.matchId); }
        if (input.dataset.dirty !== 'true') { input.value = match.channelName || ''; broadcasts.value = (match.broadcastChannels || []).includes(input.value) ? input.value : ''; }
      }
    }
    updateProviderStatus();
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
  $('login').onsubmit = async event => {
    event.preventDefault();
    if (loggingIn) return;
    loggingIn = true;
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    try { await api('login', { username: $('username').value, password: $('password').value }); $('password').value = ''; await open(); }
    catch (error) { message(error.message, true); }
    finally { loggingIn = false; if (submit) submit.disabled = false; }
  };
  function startPolling() { clearInterval(polling); polling = setInterval(() => refresh(!snapshot).then(() => {
    $('login').hidden = true; $('workspace').hidden = false; $('refresh').hidden = false; $('logout').hidden = false;
  }).catch(error => message(error.message, true)), 10000); }
  async function open() { startPolling(); await refresh(); $('login').hidden = true; $('workspace').hidden = false; $('refresh').hidden = false; $('logout').hidden = false; message(''); }
  $('logout').onclick = async () => { await api('logout', {}); loggedOut(); };
  $('refresh').onclick = () => { if (!editing || confirm('توجد تغييرات غير محفوظة. تحديث القائمة؟')) refresh().catch(error => message(error.message, true)); };
  $('search').oninput = renderMatches; $('status-filter').onchange = renderMatches;
  $('import-search-form').onsubmit = async event => {
    event.preventDefault();
    $('import-search').disabled = true;
    $('import-results').replaceChildren();
    $('import-search-status').textContent = 'جاري البحث في Kooora…';
    try {
      const result = await api('matches/search', { homeTeam: $('import-home').value, awayTeam: $('import-away').value });
      if (result.job) { searchJob = result.job.id; await refresh(false); }
      else renderImportResults(result);
    } catch (error) { $('import-search-status').textContent = error.message; message(error.message, true); }
    finally { if (!searchJob) $('import-search').disabled = false; }
  };
  function renderImportResults(result = { matches: [], day: '' }) {
      $('import-search-status').textContent = result.matches.length ? `${result.matches.length} مباراة · ${result.day}` : 'لم توجد مباراة بين الفريقين اليوم في Kooora.';
      $('import-results').replaceChildren(...result.matches.map(match => {
        const row = document.createElement('div'); row.className = 'import-result';
        const name = document.createElement('div'); name.className = 'match-name'; name.textContent = `${match.homeTeam} - ${match.awayTeam}`;
        const meta = document.createElement('small'); meta.textContent = `${match.league} · ${new Intl.DateTimeFormat('ar', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(match.scheduledAt))} · ${match.status || ''}`;
        name.append(meta);
        const channels = document.createElement('span'); channels.className = 'import-channels'; channels.textContent = match.channels.join(' · ') || 'القنوات غير محددة حالياً';
        const add = button('plus', 'إضافة للعرض في الموقع', async () => {
          if (editing && !confirm('توجد تغييرات غير محفوظة. متابعة إضافة المباراة؟')) return;
          add.disabled = true;
          try {
            const result = await api('matches/import', { candidateId: match.candidateId });
            importJob = result.job.id;
            message('بدأ تأكيد المباراة وإضافتها للعرض في الموقع.');
            await refresh(false);
          } catch (error) { message(error.message, true); add.disabled = false; }
        });
        add.append(document.createTextNode('إضافة للعرض في الموقع')); add.className = 'import-match-button primary';
        add.dataset.unavailable = String(!match.canImport); add.disabled = !match.canImport;
        row.append(name, channels, add); return row;
      }));
      renderJobs();
  }
  $('manual-enabled').onchange = () => { editing = true; };
  document.querySelectorAll('.notice-settings input, .notice-settings select').forEach(input => { input.oninput = () => { editing = true; }; });
  $('save-selection').onclick = async () => { try { await submitJob('selection', { enabled: $('manual-enabled').checked, matches: selected }); editing = false; message('بدأ تجهيز الاختيار في الخلفية المشتركة.'); await refresh(false); } catch (error) { message(error.message, true); } };
  $('renew-selected').onclick = async () => { const control = $('renew-selected'); control.disabled = true; try { await submitJob('refresh-links', { matchIds: renewableIds() }); message('بدأ تجديد الروابط المحددة بالتتابع.'); await refresh(false); } catch (error) { message(error.message, true); } finally { renderJobs(); } };
  $('add-notice').onclick = () => { if (noticeItems.length < 10) { noticeItems.push(newNotice()); activeNotice = noticeItems.length - 1; editing = true; } renderNotices(); };
  $('publish-notices').onclick = async () => { const button = $('publish-notices'); try { validateNoticeInputs(); button.disabled = true; await api('notices', { enabled: true, items: noticeItems, repeats: Number($('notice-repeats').value), duration: Number($('notice-duration').value), interval: Number($('notice-interval').value), matchIds: $('notice-target').value === 'selected' ? selected : [] }); message('تم نشر الإشعارات إلى المشغلات المفتوحة والـ embed.'); editing = false; } catch (error) { message(error.message, true); } finally { button.disabled = false; } };
  $('stop-notices').onclick = async () => { try { await api('notices/stop', {}); message('تم إيقاف الإشعارات فوراً.'); } catch (error) { message(error.message, true); } };
  document.querySelectorAll('nav button').forEach(node => { node.onclick = () => { document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button === node)); for (const id of ['matches-view', 'notices-view']) $(id).hidden = id !== node.dataset.view; if (node.dataset.view === 'notices-view') preview(noticeItems[activeNotice] || newNotice()); else stopNotice(previewView); }; });
  open().catch(error => message(error.message, true));
})();
