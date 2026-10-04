(() => {
  const $ = id => document.getElementById(id);
  let csrf = '', snapshot, selected = [], noticeItems = [], editing = false, polling;
  const errors = { login_required: 'سجل الدخول أولاً.', invalid_login: 'بيانات الدخول غير صحيحة.', too_many_attempts: 'محاولات كثيرة. حاول بعد 15 دقيقة.', no_free_provider: 'كل الموارد مشغولة الآن. لم تتغير القناة القديمة؛ حرر مورداً قبل اختبار قناة أخرى.', channel_not_found: 'لم يعثر المورد على الاسم المحدد. لم تتغير القناة.', channel_probe_failed: 'رابط القناة لا يمرر الفيديو الآن. لم تتغير القناة.', operation_in_progress: 'هناك عملية قيد التنفيذ.', operation_failed: 'تعذر إكمال العملية. راجع حالة الموارد قبل إعادة المحاولة.', invalid_image: 'الصورة غير صالحة أو كبيرة جداً.' };
  const phaseNames = { preparing: 'تحضير', discovering: 'بحث لدى المورد', testing_media: 'اختبار الفيديو', saving: 'حفظ القناة', assigning: 'توزيع وتجهيز الموارد', ready: 'اكتملت العملية' };
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
      const save = button('radio', 'اختبار واعتماد القناة', async () => { save.disabled = true; try { await api('channel', { matchId: match.matchId, channel: input.value }); message('بدأ البحث والاختبار. القناة القديمة تبقى حتى نجاح اختبار الجديدة.'); await refresh(false); } catch (error) { message(error.message, true); } finally { save.disabled = false; } });
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
      const selection = snapshot.state.selection;
      selected = selection?.matches || snapshot.matches.filter(row => row.viewingMode === 'stream').slice(0, 8).map(row => row.matchId);
      $('manual-enabled').checked = selection?.enabled === true;
      $('channel-names').replaceChildren(...snapshot.channels.map(channel => { const option = document.createElement('option'); option.value = channel.name; return option; }));
      $('servers').replaceChildren(...snapshot.status.accounts.map(account => { const node = document.createElement('span'); node.className = `server ${/STOPPED|UNAVAILABLE|COOLDOWN|STALLED/.test(account.status) ? 'bad' : ''}`; node.textContent = `${account.provider} · ${account.status}${account.current_channel ? ` · ${account.current_channel}` : ''}`; return node; }));
      noticeItems = (snapshot.state.notices.items || []).map(item => ({ text: item.text, image: item.image }));
      if (!noticeItems.length) noticeItems = [{ text: '', image: '' }];
      for (const key of ['repeats', 'duration', 'interval']) $(`notice-${key}`).value = snapshot.state.notices[key];
      $('notice-target').value = snapshot.state.notices.matchIds.length ? 'selected' : 'all';
      renderMatches(); renderNotices(); editing = false;
    }
    for (const row of document.querySelectorAll('.match-row')) {
      const match = snapshot.matches.find(match => match.matchId === row.dataset.match);
      if (match) { const badge = row.querySelector('.badge'); badge.textContent = `${match.isLive ? 'مباشر' : match.status} · ${match.sourceReady ? 'جاهز' : 'غير جاهز'}`; badge.classList.toggle('ready', match.sourceReady); }
    }
    renderJobs();
  }
  function preview(item) { $('preview-text').textContent = item.text; $('preview-image').hidden = !item.image; if (item.image) $('preview-image').src = item.image; }
  async function compressImage(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error('اختر صورة PNG أو JPEG أو WebP أصغر من 5 ميغابايت.');
    const bitmap = await createImageBitmap(file); const ratio = Math.min(1, 480 / bitmap.width, 320 / bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return canvas.toDataURL('image/jpeg', .8);
  }
  function renderNotices() {
    $('notice-list').replaceChildren(...noticeItems.map((item, index) => {
      const row = document.createElement('div'); row.className = 'notice-editor';
      const text = document.createElement('textarea'); text.maxLength = 240; text.value = item.text; text.placeholder = 'نص الإشعار'; text.oninput = () => { item.text = text.value; editing = true; preview(item); };
      const picker = document.createElement('label'); picker.className = 'image-picker'; picker.append(document.createTextNode('صورة صغيرة'));
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp';
      file.onchange = async () => { if (!file.files[0]) return; try { const result = await api('image', { image: await compressImage(file.files[0]) }); item.image = result.image; editing = true; renderNotices(); preview(item); } catch (error) { message(error.message, true); } };
      picker.append(file); if (item.image) { const image = document.createElement('img'); image.className = 'editor-image'; image.src = item.image; image.alt = ''; picker.append(image); picker.append(button('x', 'إزالة الصورة', () => { item.image = ''; renderNotices(); })); }
      row.append(text, picker, button('trash-2', 'حذف الإشعار', () => { noticeItems.splice(index, 1); editing = true; renderNotices(); })); return row;
    }));
    preview(noticeItems[0] || { text: '', image: '' }); $('add-notice').disabled = noticeItems.length >= 10;
  }
  $('login').onsubmit = async event => { event.preventDefault(); try { await api('login', { username: $('username').value, password: $('password').value }); $('password').value = ''; await open(); } catch (error) { message(error.message, true); } };
  async function open() { await refresh(); $('login').hidden = true; $('workspace').hidden = false; $('refresh').hidden = false; $('logout').hidden = false; message(''); clearInterval(polling); polling = setInterval(() => refresh(false).catch(error => message(error.message, true)), 3000); }
  $('logout').onclick = async () => { await api('logout', {}); loggedOut(); };
  $('refresh').onclick = () => { if (!editing || confirm('توجد تغييرات غير محفوظة. تحديث القائمة؟')) refresh().catch(error => message(error.message, true)); };
  $('search').oninput = renderMatches; $('status-filter').onchange = renderMatches;
  $('manual-enabled').onchange = () => { editing = true; };
  $('save-selection').onclick = async () => { try { await api('selection', { enabled: $('manual-enabled').checked, matches: selected }); editing = false; message('بدأ تجهيز الاختيار في الخلفية المشتركة.'); await refresh(false); } catch (error) { message(error.message, true); } };
  $('add-notice').onclick = () => { if (noticeItems.length < 10) noticeItems.push({ text: '', image: '' }); renderNotices(); };
  $('publish-notices').onclick = async () => { try { await api('notices', { enabled: true, items: noticeItems, repeats: Number($('notice-repeats').value), duration: Number($('notice-duration').value), interval: Number($('notice-interval').value), matchIds: $('notice-target').value === 'selected' ? selected : [] }); message('تم نشر الإشعارات إلى المشغلات المفتوحة والـ embed.'); editing = false; } catch (error) { message(error.message, true); } };
  $('stop-notices').onclick = async () => { try { await api('notices/stop', {}); message('تم إيقاف الإشعارات فوراً.'); } catch (error) { message(error.message, true); } };
  document.querySelectorAll('nav button').forEach(node => { node.onclick = () => { document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button === node)); for (const id of ['matches-view', 'notices-view']) $(id).hidden = id !== node.dataset.view; }; });
  open().catch(() => loggedOut());
})();
