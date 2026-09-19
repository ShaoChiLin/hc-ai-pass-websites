// STEP 3「AI 安全三問」的靜態約定檢查。
//
// 這支測驗層把答對的題目對應到畫面上看不到的第 N 個 `.security-check`，
// app.js 再讀那三個 checkbox 決定能不能進申請書。所以真正容易壞掉的不是
// JS 邏輯，而是 index.html 被改動之後**題數與關卡數對不上**、或是正解字母
// 根本沒有對應的選項——那時測驗層會靜靜地 return，關卡永遠過不了。
// 這裡只查那條約定，不模擬 DOM（本 repo 的測試刻意不帶任何外部相依）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'subsidy', 'index.html'), 'utf8');
const quizJs = readFileSync(join(root, 'subsidy', 'security-quiz.js'), 'utf8');

/** 抓出每個 `<li class="quiz-item">` 的正解與選項值。 */
function parseItems(source) {
  const list = source.match(/<ol class="quiz-list" id="securityQuiz">([\s\S]*?)<\/ol>/);
  assert.ok(list, '找不到 <ol class="quiz-list" id="securityQuiz">');
  return [...list[1].matchAll(/<li class="quiz-item"([\s\S]*?)<\/li>/g)].map((m) => {
    const block = m[1];
    const answer = block.match(/data-answer="([^"]+)"/)?.[1];
    const radios = [...block.matchAll(/<input type="radio" name="([^"]+)" value="([^"]+)"/g)];
    return {
      answer,
      explain: block.match(/data-explain="([^"]*)"/)?.[1] ?? '',
      names: [...new Set(radios.map((r) => r[1]))],
      values: radios.map((r) => r[2]),
    };
  });
}

// `.check-list` 在別的步驟也有用（申請須知、應備文件…），所以只切出 STEP 3 這一段來看。
const panel3 = html.slice(html.indexOf('id="panel-3"'), html.indexOf('id="panel-4"'));
assert.ok(panel3.length > 500, '切不出 STEP 3 的區塊，index.html 的結構可能改了');

const items = parseItems(html);
const gates = html.match(/class="security-check"/g) ?? [];

test('題數與關卡數相等，否則測驗層會整個停用', () => {
  assert.equal(items.length, 3);
  assert.equal(gates.length, items.length);
});

test('關卡 checkbox 對使用者隱藏', () => {
  assert.match(html, /<div class="security-gate" hidden>/);
});

test('每題三個選項，共用同一個 name，值為 A/B/C', () => {
  for (const [i, item] of items.entries()) {
    assert.deepEqual(item.values, ['A', 'B', 'C'], `第 ${i + 1} 題的選項值不是 A/B/C`);
    assert.equal(item.names.length, 1, `第 ${i + 1} 題的 radio 不同名，會變成可複選`);
  }
});

test('各題的 name 互不相同，否則三題會連動成一組', () => {
  const names = items.map((item) => item.names[0]);
  assert.equal(new Set(names).size, items.length);
});

test('正解是使用者確認過的 B、C、B', () => {
  assert.deepEqual(items.map((item) => item.answer), ['B', 'C', 'B']);
});

test('每題的正解都找得到對應的選項', () => {
  for (const [i, item] of items.entries()) {
    assert.ok(item.values.includes(item.answer), `第 ${i + 1} 題的正解 ${item.answer} 沒有對應選項`);
  }
});

test('每題都有解說與回饋欄位', () => {
  for (const [i, item] of items.entries()) {
    assert.ok(item.explain.length > 10, `第 ${i + 1} 題缺 data-explain`);
  }
  assert.equal((html.match(/class="quiz-feedback"/g) ?? []).length, items.length);
});

test('STEP 3 裡舊的自我檢核勾選卡已經移除', () => {
  assert.doesNotMatch(panel3, /class="check-list"/);
  assert.doesNotMatch(panel3, /class="check-card"/);
});

test('security-quiz.js 掛在 app.js 之後', () => {
  const app = html.indexOf('src="./app.js');
  const quiz = html.indexOf('src="./security-quiz.js');
  assert.ok(app > -1 && quiz > app, 'security-quiz.js 必須排在 app.js 後面才抓得到已存在的節點');
});

test('測驗層仍以 .security-check 為關卡，沒有伸手改 app.js 的狀態', () => {
  assert.match(quizJs, /querySelectorAll\('\.security-check'\)/);
  // app.js 的內部狀態（`state.securityComplete` 等）必須只由它自己的 syncFromDom() 重算。
  const code = quizJs.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\bstate\s*\./);
});
