(() => {
  'use strict';

  const core = window.RepairCore;
  if (!core) return;

  const API = new URLSearchParams(location.search).get('api') ||
    (location.pathname.startsWith('/report') ? '/api/repairs' : 'http://127.0.0.1:3000/api/repairs');
  const RECENT_KEY = 'taipei-repair.recent-cases.v1';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
  const state = { view: 'dashboard', step: 1, files: [], coordinates: '', tickets: [], selectedCase: '', online: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const form = $('#repair-form');
  const previousButton = $('#previous-step');
  const nextButton = $('#next-step');
  const attachmentInput = $('#attachment-input');
  const attachmentList = $('#attachment-list');
  const dropZone = $('#drop-zone');
  const trackingInput = $('#tracking-input');
  const trackingEmpty = $('#track-empty');
  const trackingResult = $('#track-result');
  const successDialog = $('#success-dialog');
  const toast = $('#toast');

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
  const recentIds = () => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  };
  const rememberCase = (id) => {
    const ids = [id, ...recentIds().filter((value) => value !== id)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  };

  async function api(path = '', options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options.body instanceof Blob || options.body instanceof File ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `服務暫時無法使用（${response.status}）`), { status: response.status });
    return data;
  }

  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function setServiceState(online) {
    state.online = online;
    const context = $('.topbar-context');
    context.classList.toggle('offline', !online);
    context.lastElementChild.textContent = online ? '資料庫與通知服務正常' : '離線預覽模式';
  }

  function categoryMarkup(category, mode) {
    if (mode === 'form') return `<label class="category-option"><input type="radio" name="category" value="${category.id}"><span><i data-lucide="${category.icon}"></i>${escapeHtml(category.label)}</span></label>`;
    if (mode === 'help') return `<article class="help-category"><span><i data-lucide="${category.icon}"></i></span><div><strong>${escapeHtml(category.label)}</strong><small>${escapeHtml(category.description)}</small></div></article>`;
    return `<button class="category-card" type="button" data-category-start="${category.id}"><span><i data-lucide="${category.icon}"></i></span><strong>${escapeHtml(category.label)}</strong><small>${escapeHtml(category.description)}</small></button>`;
  }

  function renderCategories() {
    $('#quick-categories').innerHTML = core.CATEGORIES.map((item) => categoryMarkup(item, 'quick')).join('');
    $('#form-categories').innerHTML = core.CATEGORIES.map((item) => categoryMarkup(item, 'form')).join('');
    $('#help-categories').innerHTML = core.CATEGORIES.map((item) => categoryMarkup(item, 'help')).join('');
    refreshIcons();
  }

  const statusLabel = (status) => core.STATUS_FLOW.find((item) => item.id === status)?.label || '已通報';
  const allTickets = () => [...state.tickets, ...core.DEMO_TICKETS.filter((demo) => !state.tickets.some((item) => item.id === demo.id))]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  function ticketCard(ticket) {
    const category = core.getCategory(ticket.category);
    return `<article class="ticket-card"><span class="ticket-symbol"><i data-lucide="${category.icon}"></i></span><div class="ticket-main"><strong>${escapeHtml(ticket.title)}</strong><div class="ticket-meta"><span><i data-lucide="hash"></i>${escapeHtml(ticket.id)}</span><span><i data-lucide="map-pin"></i>${escapeHtml(ticket.site)}・${escapeHtml(ticket.area)}</span><span><i data-lucide="clock-3"></i>${escapeHtml(core.formatDateTime(ticket.updatedAt))}</span></div></div><div class="ticket-side"><span class="status-badge ${ticket.status}">${escapeHtml(statusLabel(ticket.status))}</span><button type="button" data-track-case="${escapeHtml(ticket.id)}">查看進度</button></div></article>`;
  }

  function renderDashboard() {
    const tickets = allTickets();
    $('#metric-total').textContent = tickets.length;
    $('#metric-active').textContent = tickets.filter((item) => !['completed', 'closed'].includes(item.status)).length;
    $('#metric-done').textContent = tickets.filter((item) => ['completed', 'closed'].includes(item.status)).length;
    $('#dashboard-ticket-list').innerHTML = tickets.slice(0, 4).map(ticketCard).join('') || '<p class="track-empty">目前沒有報修案件。</p>';
    refreshIcons();
  }

  function navigate(view, options = {}) {
    if (!['dashboard', 'new', 'track', 'help'].includes(view)) view = 'dashboard';
    state.view = view;
    $$('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    $$('.nav-item, .bottom-nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    if (!options.keepHash) history.replaceState(null, '', `${location.pathname}${location.search}#${view}`);
    if (view === 'dashboard') renderDashboard();
    if (view === 'track' && options.caseId) {
      trackingInput.value = options.caseId;
      renderTracking(options.caseId);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reportInput() {
    return {
      category: $('input[name="category"]:checked', form)?.value || '',
      priority: $('input[name="priority"]:checked', form)?.value || 'normal',
      site: $('#site').value,
      area: $('#area').value,
      locationDetail: $('#location-detail').value,
      coordinates: state.coordinates,
      description: $('#description').value,
      attachments: state.files,
      contactName: $('#contact-name').value,
      contactPhone: $('#contact-phone').value,
      contactEmail: $('#contact-email').value,
      notify: $$('input[name="notify"]:checked', form).map((input) => input.value),
      consent: $('#consent').checked,
    };
  }

  function showFormMessage(text) {
    const message = $('#form-message');
    message.textContent = text;
    message.hidden = !text;
    if (text) message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setStep(step) {
    state.step = Math.min(4, Math.max(1, step));
    $$('[data-form-step]').forEach((panel) => {
      const active = Number(panel.dataset.formStep) === state.step;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    $$('[data-step-indicator]').forEach((item) => {
      const number = Number(item.dataset.stepIndicator);
      item.classList.toggle('active', number === state.step);
      item.classList.toggle('done', number < state.step);
    });
    previousButton.hidden = state.step === 1;
    nextButton.innerHTML = state.step === 4 ? '確認送出<i data-lucide="send"></i>' : '下一步<i data-lucide="arrow-right"></i>';
    if (state.step === 4) renderReview();
    showFormMessage('');
    refreshIcons();
  }

  function renderReview() {
    const input = reportInput();
    const category = core.getCategory(input.category);
    const notifyLabels = { line: 'LINE', email: 'Email' };
    $('#report-review').innerHTML = [
      ['問題類型', category.label + (input.priority === 'urgent' ? '（急件）' : '')],
      ['發生地點', `${input.site}・${input.area}`],
      ['詳細位置', input.locationDetail],
      ['附件', input.attachments.length ? `${input.attachments.length} 個檔案` : '未提供'],
      ['聯絡人', input.contactName || '尚未填寫'],
      ['通知方式', input.notify.map((item) => notifyLabels[item]).join('、') || '尚未選擇'],
    ].map(([label, value]) => `<div><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
  }

  function resetFiles() {
    state.files.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    state.files = [];
    attachmentInput.value = '';
    renderAttachments();
  }

  function resetForm() {
    form.reset();
    resetFiles();
    state.coordinates = '';
    $('#geo-status').textContent = '戶外設施可使用定位補充座標';
    $('#description-count').textContent = '0';
    $('.email-field').hidden = false;
    setStep(1);
  }

  function startReport(categoryId = '') {
    resetForm();
    const input = $(`input[name="category"][value="${CSS.escape(categoryId)}"]`, form);
    if (input) input.checked = true;
    navigate('new');
  }

  const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  function addFiles(files) {
    for (const file of [...files]) {
      if (state.files.length >= 3) { showToast('附件最多只能上傳 3 個'); break; }
      if (!ACCEPTED_TYPES.includes(file.type)) { showToast(`${file.name} 不是支援的格式`); continue; }
      if (file.size > MAX_FILE_BYTES) { showToast(`${file.name} 超過 5 MB`); continue; }
      if (state.files.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
      state.files.push({ file, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' });
    }
    attachmentInput.value = '';
    renderAttachments();
  }

  function renderAttachments() {
    attachmentList.innerHTML = state.files.map((item, index) => `<div class="attachment-item"><span class="attachment-preview">${item.previewUrl ? `<img src="${item.previewUrl}" alt="">` : '<i data-lucide="file-text"></i>'}</span><div class="attachment-copy"><strong>${escapeHtml(item.file.name)}</strong><small>${formatBytes(item.file.size)}</small></div><button class="attachment-remove" type="button" data-remove-file="${index}" aria-label="移除 ${escapeHtml(item.file.name)}" title="移除附件"><i data-lucide="trash-2"></i></button></div>`).join('');
    refreshIcons();
  }

  async function uploadFiles() {
    if (!state.files.length) return '';
    const { draftId } = await api('/drafts', { method: 'POST', body: '{}' });
    for (const item of state.files) {
      await api(`/drafts/${draftId}/files?filename=${encodeURIComponent(item.file.name)}`, {
        method: 'POST', body: item.file, headers: { 'Content-Type': item.file.type },
      });
    }
    return draftId;
  }

  async function submitReport() {
    const input = reportInput();
    const error = core.validateStep(4, input);
    if (error) { showFormMessage(error); return; }
    nextButton.disabled = true;
    nextButton.innerHTML = '正在建立案件…';
    try {
      const draftId = await uploadFiles();
      const payload = { ...input, attachments: undefined, consent: undefined, draftId };
      const result = await api('', { method: 'POST', body: JSON.stringify(payload) });
      state.tickets.unshift(result.case);
      state.selectedCase = result.case.id;
      rememberCase(result.case.id);
      $('#success-case-number').textContent = result.case.id;
      const line = $('#line-bind-action');
      if (result.lineBinding) {
        line.href = result.lineBinding.chatUrl;
        line.hidden = false;
      } else line.hidden = true;
      successDialog.showModal ? successDialog.showModal() : successDialog.setAttribute('open', '');
      renderDashboard();
    } catch (failure) {
      showFormMessage(failure.message || '送件失敗，請稍後再試。');
    } finally {
      nextButton.disabled = false;
      nextButton.innerHTML = '確認送出<i data-lucide="send"></i>';
      refreshIcons();
    }
  }

  function renderTicket(ticket) {
    const category = core.getCategory(ticket.category);
    const current = core.statusIndex(ticket.status);
    const timeline = core.STATUS_FLOW.map((item, index) => {
      const className = index < current ? 'done' : index === current ? 'current' : '';
      const detail = index === 0 ? core.formatDateTime(ticket.createdAt)
        : index === current ? `${item.description}・${core.formatDateTime(ticket.updatedAt)}`
          : index < current ? '已完成' : '等待前一階段完成';
      return `<li class="${className}"><span class="dot"></span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(detail)}</small></div></li>`;
    }).join('');
    trackingEmpty.hidden = true;
    trackingResult.hidden = false;
    trackingResult.innerHTML = `<section class="case-summary"><div class="case-header"><div><small>案件編號</small><h2>${escapeHtml(ticket.id)}</h2></div><span class="status-badge ${ticket.status}">${escapeHtml(statusLabel(ticket.status))}</span></div><div class="case-facts"><div><small>問題類型</small><strong>${escapeHtml(category.label)}${ticket.priority === 'urgent' ? '・急件' : ''}</strong></div><div><small>承辦單位</small><strong>${escapeHtml(ticket.assignee)}</strong></div><div><small>發生地點</small><strong>${escapeHtml(ticket.site)}・${escapeHtml(ticket.area)}</strong></div><div><small>最後更新</small><strong>${escapeHtml(core.formatDateTime(ticket.updatedAt))}</strong></div><div><small>詳細位置</small><strong>${escapeHtml(ticket.locationDetail)}</strong></div><div><small>附件</small><strong>${ticket.attachmentCount || 0} 個檔案</strong></div></div><p class="case-description">${escapeHtml(ticket.description)}</p></section><aside class="timeline-panel"><h2>處理進度</h2><ol class="status-timeline">${timeline}</ol></aside>`;
    refreshIcons();
  }

  async function renderTracking(caseId) {
    const normalized = String(caseId || '').trim().toUpperCase();
    trackingResult.hidden = true;
    trackingEmpty.hidden = false;
    if (!normalized) {
      trackingEmpty.innerHTML = '<i data-lucide="folder-search-2"></i><h2>輸入案件編號開始查詢</h2><p>案件編號會顯示在完成頁與通知訊息中。</p>';
      refreshIcons();
      return;
    }
    trackingEmpty.innerHTML = '<i data-lucide="loader-circle"></i><h2>正在查詢案件</h2><p>從案件資料庫取得最新進度…</p>';
    refreshIcons();
    try {
      const result = await api(`/${encodeURIComponent(normalized)}`);
      state.selectedCase = result.case.id;
      const index = state.tickets.findIndex((item) => item.id === result.case.id);
      if (index >= 0) state.tickets[index] = result.case; else state.tickets.unshift(result.case);
      renderTicket(result.case);
    } catch (failure) {
      const demo = core.DEMO_TICKETS.find((item) => item.id === normalized);
      if (demo) return renderTicket(demo);
      trackingEmpty.innerHTML = `<i data-lucide="circle-x"></i><h2>找不到這個案件</h2><p>${escapeHtml(failure.status === 404 ? '請確認案件編號是否正確。' : '目前無法連線案件資料庫，請稍後再試。')}</p>`;
      refreshIcons();
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('#next-step')) {
      const error = core.validateStep(state.step, reportInput());
      if (error) showFormMessage(error); else if (state.step < 4) setStep(state.step + 1); else submitReport();
      return;
    }
    if (event.target.closest('#previous-step')) return setStep(state.step - 1);
    if (event.target.closest('#notification-button')) return showToast('案件進度會透過 LINE 與 Email 同步通知');
    if (event.target.closest('.profile-button')) return showToast('INNOSERVE 展示模式・一般市民身分');
    if (event.target.closest('.dialog-close')) { successDialog.close(); return; }
    if (event.target.closest('#copy-case')) {
      const value = $('#success-case-number').textContent;
      navigator.clipboard.writeText(value).then(() => showToast('案件編號已複製')).catch(() => showToast(`案件編號：${value}`));
      return;
    }
    if (event.target.closest('#view-case')) {
      successDialog.close(); trackingInput.value = state.selectedCase; navigate('track', { caseId: state.selectedCase }); return;
    }
    if (event.target.closest('#new-case')) { successDialog.close(); startReport(); return; }
    if (event.target.closest('#location-button')) {
      const status = $('#geo-status');
      if (!navigator.geolocation) { status.textContent = '此瀏覽器不支援定位，請以文字描述位置。'; return; }
      status.textContent = '正在取得目前位置…';
      navigator.geolocation.getCurrentPosition((position) => {
        state.coordinates = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        status.textContent = `已加入座標 ${state.coordinates}`;
      }, () => { status.textContent = '無法取得定位，請確認瀏覽器權限或以文字描述。'; }, { enableHighAccuracy: true, timeout: 10000 });
      return;
    }
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { event.preventDefault(); viewButton.dataset.view === 'new' ? startReport() : navigate(viewButton.dataset.view); return; }
    const categoryButton = event.target.closest('[data-category-start]');
    if (categoryButton) { startReport(categoryButton.dataset.categoryStart); return; }
    const caseButton = event.target.closest('[data-track-case]');
    if (caseButton) { trackingInput.value = caseButton.dataset.trackCase; navigate('track', { caseId: caseButton.dataset.trackCase }); return; }
    const removeButton = event.target.closest('[data-remove-file]');
    if (removeButton) {
      const [removed] = state.files.splice(Number(removeButton.dataset.removeFile), 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderAttachments();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'description') $('#description-count').textContent = event.target.value.length;
    if (form.contains(event.target) && state.step === 4) renderReview();
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'attachment-input') addFiles(event.target.files);
    if (event.target.matches('input[name="notify"]')) {
      $('.email-field').hidden = !$('input[name="notify"][value="email"]', form).checked;
      if (state.step === 4) renderReview();
    }
  });
  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'tracking-form') return;
    event.preventDefault();
    renderTracking(trackingInput.value);
  });
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

  async function boot() {
    renderCategories();
    renderAttachments();
    try {
      await api('/health');
      setServiceState(true);
      const loaded = await Promise.all(recentIds().map((id) => api(`/${encodeURIComponent(id)}`).then((result) => result.case).catch(() => null)));
      state.tickets = loaded.filter(Boolean);
    } catch {
      setServiceState(false);
    }
    renderDashboard();
    const initial = location.hash.replace('#', '');
    navigate(['dashboard', 'new', 'track', 'help'].includes(initial) ? initial : 'dashboard', { keepHash: true });
    refreshIcons();
  }

  boot();
})();
