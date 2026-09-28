(function (root) {
  'use strict';

  var CATEGORIES = [
    { id: 'water', label: '水電設備', icon: 'droplets', description: '漏水、照明、插座' },
    { id: 'air', label: '空調通風', icon: 'air-vent', description: '冷氣、異味、通風' },
    { id: 'facility', label: '公共設施', icon: 'building-2', description: '門窗、電梯、家具' },
    { id: 'network', label: '網路資訊', icon: 'wifi', description: '網路、電話、設備' },
    { id: 'outdoor', label: '戶外環境', icon: 'trees', description: '道路、照明、環境' },
    { id: 'other', label: '其他問題', icon: 'ellipsis', description: '無法歸類的狀況' },
  ];

  var STATUS_FLOW = [
    { id: 'received', label: '已通報', description: '系統已收到您的報修資料' },
    { id: 'assigned', label: '已受理', description: '案件已完成分類並交由承辦單位' },
    { id: 'processing', label: '處理中', description: '維修人員已接單處理' },
    { id: 'completed', label: '已完成', description: '案件已完成並通知報修人' },
    { id: 'closed', label: '已結案', description: '確認處理結果後完成結案' },
  ];

  var DEMO_TICKETS = [
    {
      id: 'RPR-20260929-0142',
      category: 'water',
      priority: 'urgent',
      title: '台北市政大樓 3 樓茶水間持續漏水',
      site: '台北市政大樓',
      area: '3 樓東側',
      locationDetail: '茶水間洗手台下方',
      description: '今天早上發現排水管接縫持續滴水，地面已放置水桶，請協助檢查。',
      status: 'processing',
      createdAt: '2026-09-29T09:12:00+08:00',
      updatedAt: '2026-09-29T10:05:00+08:00',
      assignee: '水電維護組',
      attachmentCount: 2,
      contactName: '陳先生',
      contactPhone: '0912345678',
      notify: ['line', 'email'],
    },
    {
      id: 'RPR-20260928-0087',
      category: 'air',
      priority: 'normal',
      title: '信義區民活動中心會議室冷氣異音',
      site: '信義區民活動中心',
      area: '2 樓會議室 A',
      locationDetail: '靠窗側冷氣出風口',
      description: '冷氣開啟約十分鐘後會出現規律異音，但仍可正常送風。',
      status: 'assigned',
      createdAt: '2026-09-28T15:40:00+08:00',
      updatedAt: '2026-09-29T08:30:00+08:00',
      assignee: '機電維護組',
      attachmentCount: 1,
      contactName: '林小姐',
      contactPhone: '0922333444',
      notify: ['line'],
    },
    {
      id: 'RPR-20260925-0031',
      category: 'facility',
      priority: 'normal',
      title: '台北市政大樓一樓無障礙門按鈕失效',
      site: '台北市政大樓',
      area: '1 樓西側入口',
      locationDetail: '無障礙自動門外側',
      description: '按下開門按鈕沒有反應，已完成現場檢修與功能測試。',
      status: 'completed',
      createdAt: '2026-09-25T11:20:00+08:00',
      updatedAt: '2026-09-26T16:15:00+08:00',
      assignee: '設施維護組',
      attachmentCount: 1,
      contactName: '王先生',
      contactPhone: '0933555666',
      notify: ['email'],
    },
  ];

  function getCategory(id) {
    return CATEGORIES.find(function (category) { return category.id === id; }) || CATEGORIES[CATEGORIES.length - 1];
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function validateStep(step, input) {
    if (step === 1) {
      if (!CATEGORIES.some(function (category) { return category.id === input.category; })) return '請先選擇問題類型。';
      if (!['normal', 'urgent'].includes(input.priority)) return '請選擇緊急程度。';
    }
    if (step === 2) {
      if (!String(input.site || '').trim()) return '請選擇問題發生的場域。';
      if (String(input.area || '').trim().length < 2) return '請填寫樓層或區域。';
      if (String(input.locationDetail || '').trim().length < 3) return '請提供更明確的詳細位置。';
      if (String(input.description || '').trim().length < 10) return '問題描述至少需要 10 個字。';
    }
    if (step === 3) {
      if ((input.attachments || []).length > 3) return '附件最多只能上傳 3 個。';
    }
    if (step === 4) {
      if (String(input.contactName || '').trim().length < 2) return '請填寫聯絡人姓名。';
      if (!/^09\d{8}$/.test(normalizePhone(input.contactPhone))) return '請輸入正確的手機號碼。';
      if (!Array.isArray(input.notify) || input.notify.length === 0) return '請至少選擇一種通知方式。';
      if (input.notify.includes('email') && !validEmail(input.contactEmail)) return '請輸入正確的 Email。';
      if (input.consent !== true) return '請確認資料並勾選同意事項。';
    }
    return '';
  }

  function pad(value, length) {
    return String(value).padStart(length, '0');
  }

  function createTicketId(now, randomValue) {
    var date = now instanceof Date ? now : new Date(now || Date.now());
    var random = Number.isFinite(randomValue) ? randomValue : Math.random();
    var serial = Math.floor(Math.max(0, Math.min(.9999, random)) * 10000);
    return 'RPR-' + date.getFullYear() + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) + '-' + pad(serial, 4);
  }

  function buildTicket(input, options) {
    options = options || {};
    var now = options.now instanceof Date ? options.now : new Date();
    var category = getCategory(input.category);
    return {
      id: createTicketId(now, options.randomValue),
      category: category.id,
      priority: input.priority,
      title: String(input.site).trim() + ' ' + String(input.locationDetail).trim() + ' ' + category.label,
      site: String(input.site).trim(),
      area: String(input.area).trim(),
      locationDetail: String(input.locationDetail).trim(),
      coordinates: input.coordinates || '',
      description: String(input.description).trim(),
      status: 'received',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      assignee: '待分派',
      attachmentCount: (input.attachments || []).length,
      attachmentNames: (input.attachments || []).map(function (file) { return file.name; }),
      contactName: String(input.contactName).trim(),
      contactPhone: normalizePhone(input.contactPhone),
      contactEmail: String(input.contactEmail || '').trim(),
      notify: input.notify.slice(),
    };
  }

  function statusIndex(status) {
    var index = STATUS_FLOW.findIndex(function (item) { return item.id === status; });
    return index < 0 ? 0 : index;
  }

  function formatDateTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '時間未提供';
    return new Intl.DateTimeFormat('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  }

  var api = {
    CATEGORIES: CATEGORIES,
    STATUS_FLOW: STATUS_FLOW,
    DEMO_TICKETS: DEMO_TICKETS,
    getCategory: getCategory,
    normalizePhone: normalizePhone,
    validEmail: validEmail,
    validateStep: validateStep,
    createTicketId: createTicketId,
    buildTicket: buildTicket,
    statusIndex: statusIndex,
    formatDateTime: formatDateTime,
  };

  root.RepairCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
