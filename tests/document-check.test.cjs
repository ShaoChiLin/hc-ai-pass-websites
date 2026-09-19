const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const check = require(join(__dirname, '..', 'subsidy', 'document-check.js'));

test('身分證明欄位若看到發票線索會提示傳錯文件', () => {
  const result = check.evaluateEvidence('身分證明', {
    fileName: 'invoice-2026-09.pdf',
    pdfText: '電子發票 金額 3,500 元 日期 2026/09/18',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'type-mismatch');
});

test('購買憑證需要發票或收據線索，也要有金額或日期等欄位', () => {
  const ok = check.evaluateEvidence('購買憑證', {
    fileName: 'receipt-ai-tool.pdf',
    pdfText: '收據 日期 2026/09/18 品項 AI 工具訂閱 合計 NT$3,500',
  });
  assert.equal(ok.ok, true);

  const weak = check.evaluateEvidence('購買憑證', {
    fileName: 'random-upload.pdf',
    pdfText: '這是一份說明文件，沒有購買憑證欄位',
  });
  assert.equal(weak.ok, false);
  assert.equal(weak.code, 'insufficient-evidence');
});

test('帳戶資料可用存摺關鍵字或帳號格式通過', () => {
  const byKeyword = check.evaluateEvidence('帳戶資料', {
    fileName: 'passbook-cover.jpg',
    pdfText: '',
  });
  assert.equal(byKeyword.ok, true);

  const byAccount = check.evaluateEvidence('帳戶資料', {
    fileName: 'bank.pdf',
    pdfText: '銀行 分行 戶名 王小明 帳號 700-123456789012',
  });
  assert.equal(byAccount.ok, true);
});

test('低收入戶證明要有低收入線索與日期或有效期間線索', () => {
  const ok = check.evaluateEvidence('低收入戶證明', {
    fileName: 'low-income-certificate.pdf',
    pdfText: '低收入戶證明 有效期間 2026/01/01 至 2026/12/31',
  });
  assert.equal(ok.ok, true);

  const weak = check.evaluateEvidence('低收入戶證明', {
    fileName: 'low-income-certificate.pdf',
    pdfText: '低收入戶證明',
  });
  assert.equal(weak.ok, false);
});

test('影像版面線索可讓身分證照片通過但不替發票憑證補足欄位', () => {
  const card = {
    width: 1600,
    height: 1000,
    edgeDensity: 0.02,
    foregroundRatio: 0.2,
    blueRatio: 0.01,
  };

  assert.equal(check.evaluateEvidence('身分證明', { imageStats: card }).ok, true);
  assert.equal(check.evaluateEvidence('購買憑證', { imageStats: card }).ok, false);
});

test('PDF literal strings can be extracted for local review', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\nBT (統一發票) Tj (合計 NT$3,500) Tj ET');
  const text = check.extractPdfTextFromBytes(bytes);

  assert.match(text, /統一發票/);
  assert.match(text, /3,500/);
});
