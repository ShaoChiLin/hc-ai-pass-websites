const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const check = require(join(__dirname, '..', 'subsidy', 'image-check.js'));

const W = 512;
const H = 512;

/** 產生一張灰階測試圖。`fill(x, y)` 回 0–255。 */
function image(fill) {
  const gray = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) gray[y * W + x] = fill(x, y);
  }
  return gray;
}

/** 密集細線，模擬佈滿文字的發票。 */
const textLike = (x, y) => (x % 4 < 2 && y % 6 < 3 ? 30 : 235);

/** 均值模糊。用來製造「同一張圖但失焦」的對照組。 */
function blur(gray, radius) {
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          sum += gray[sy * W + sx];
          n++;
        }
      }
      out[y * W + x] = sum / n;
    }
  }
  return out;
}

test('describe 算出的亮度與標準差符合定義', () => {
  const flat = image(() => 100);
  const stats = check.describe(flat, W, H);
  assert.equal(stats.mean, 100);
  assert.equal(stats.stdDev, 0);
  assert.equal(stats.clipRatio, 0);

  const half = image((x) => (x < W / 2 ? 0 : 200));
  const s2 = check.describe(half, W, H);
  assert.equal(s2.mean, 100);
  assert.equal(s2.stdDev, 100);
});

test('clipRatio 只算接近純白的像素', () => {
  const stats = check.describe(image((x) => (x < W / 4 ? 255 : 10)), W, H);
  assert.ok(Math.abs(stats.clipRatio - 0.25) < 0.01);
});

test('銳利度隨模糊程度單調下降', () => {
  const sharp = image(textLike);
  const levels = [0, 1, 3, 6].map((r) => check.tileSharpness(r ? blur(sharp, r) : sharp, W, H));

  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] < levels[i - 1], `模糊越重分數應越低：${levels.join(' → ')}`);
  }
  assert.ok(levels[0] > check.LIMITS.minSharpness * 10, `清晰(${levels[0]}) 應遠高於門檻`);
  assert.ok(levels[3] < check.LIMITS.minSharpness, `糊到不能看(${levels[3]}) 應低於門檻`);
});

test('純色畫面的銳利度為零', () => {
  assert.equal(check.tileSharpness(image(() => 128), W, H), 0);
});

/**
 * 這是分塊取百分位存在的理由，退回整張平均就會壞掉。
 * 存摺封面只有左上角一小塊有字，其餘全是空白。
 */
test('大片留白但局部清晰的文件不會被當成模糊', () => {
  const sparse = image((x, y) => (x < W / 8 && y < H / 8 ? textLike(x, y) : 70));
  const score = check.tileSharpness(sparse, W, H);
  assert.ok(score > check.LIMITS.minSharpness, `局部清晰的稀疏文件(${score}) 不該低於門檻`);

  const blurred = check.tileSharpness(blur(sparse, 6), W, H);
  assert.ok(blurred < check.LIMITS.minSharpness, `同一張糊掉後(${blurred}) 應低於門檻`);
});

test('judge 依嚴重度回報單一問題', () => {
  const base = { width: 1512, height: 2016, mean: 200, stdDev: 40, clipRatio: 0, sharpness: 900 };

  assert.equal(check.judge(base).ok, true);
  assert.equal(check.judge({ ...base, width: 480, height: 640 }).ok, true);

  assert.equal(check.judge({ ...base, width: 400, height: 500 }).code, 'too-small');
  assert.equal(check.judge({ ...base, stdDev: 1 }).code, 'blank');
  assert.equal(check.judge({ ...base, clipRatio: 0.95 }).code, 'overexposed');
  assert.equal(check.judge({ ...base, mean: 20 }).code, 'too-dark');
  assert.equal(check.judge({ ...base, sharpness: 10 }).code, 'blurry');
});

test('解析度不足優先於模糊回報，重拍才有意義', () => {
  const result = check.judge({
    width: 200, height: 260, mean: 200, stdDev: 40, clipRatio: 0, sharpness: 5,
  });
  assert.equal(result.code, 'too-small');
});

test('每個問題都帶著看得懂的說明與建議', () => {
  const codes = [
    { width: 100, height: 100, mean: 200, stdDev: 40, clipRatio: 0, sharpness: 900 },
    { width: 1512, height: 2016, mean: 200, stdDev: 1, clipRatio: 0, sharpness: 900 },
    { width: 1512, height: 2016, mean: 200, stdDev: 40, clipRatio: 0.9, sharpness: 900 },
    { width: 1512, height: 2016, mean: 10, stdDev: 40, clipRatio: 0, sharpness: 900 },
    { width: 1512, height: 2016, mean: 200, stdDev: 40, clipRatio: 0, sharpness: 5 },
  ];
  for (const stats of codes) {
    const r = check.judge(stats);
    assert.equal(r.ok, false);
    assert.ok(r.message.length > 5, '要有問題描述');
    assert.ok(r.hint.length > 5, '要有可以照做的建議');
  }
});

test('非影像檔直接跳過，不擋 PDF', async () => {
  const r = await check.inspect({ type: 'application/pdf' });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
});

test('瀏覽器不支援時放行而不是擋下', async () => {
  const r = await check.inspect({ type: 'image/jpeg' });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
});
