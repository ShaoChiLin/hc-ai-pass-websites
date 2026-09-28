const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../repair-core.js');

test('案件編號包含日期與四碼流水號', () => {
  const id = core.createTicketId(new Date('2026-09-29T08:00:00+08:00'), 0.0142);
  assert.equal(id, 'RPR-20260929-0142');
});

test('第二步要求完整地點與至少十字描述', () => {
  assert.equal(core.validateStep(2, { site: '青年館', area: '3 樓', locationDetail: '茶水間', description: '漏水' }), '問題描述至少需要 10 個字。');
  assert.equal(core.validateStep(2, { site: '青年館', area: '3 樓', locationDetail: '茶水間', description: '洗手台下方持續漏水且地面積水' }), '');
});

test('聯絡方式檢查手機、通知渠道與 Email', () => {
  assert.equal(core.validateStep(4, { contactName: '陳先生', contactPhone: '0912-345-678', notify: ['line'], consent: true }), '');
  assert.equal(core.validateStep(4, { contactName: '陳先生', contactPhone: '0912', notify: ['line'], consent: true }), '請輸入正確的手機號碼。');
  assert.equal(core.validateStep(4, { contactName: '陳先生', contactPhone: '0912345678', notify: ['email'], contactEmail: 'bad', consent: true }), '請輸入正確的 Email。');
});

test('建立案件時只保存附件名稱與數量', () => {
  const ticket = core.buildTicket({
    category: 'water', priority: 'urgent', site: '青年館', area: '3 樓', locationDetail: '茶水間',
    description: '洗手台下方持續漏水且地面積水', attachments: [{ name: 'leak.jpg' }],
    contactName: '陳先生', contactPhone: '0912345678', contactEmail: '', notify: ['line'],
  }, { now: new Date('2026-09-29T00:00:00.000Z'), randomValue: 0.5 });
  assert.equal(ticket.id, 'RPR-20260929-5000');
  assert.equal(ticket.attachmentCount, 1);
  assert.deepEqual(ticket.attachmentNames, ['leak.jpg']);
  assert.equal(ticket.status, 'received');
});

test('狀態順序可供時間軸判斷已完成節點', () => {
  assert.equal(core.statusIndex('received'), 0);
  assert.equal(core.statusIndex('processing'), 2);
  assert.equal(core.statusIndex('unknown'), 0);
});
