/**
 * 上傳影像的品質預檢（第一層）。
 *
 * 目的是在檔案離開瀏覽器之前，攔下「拍了等於沒拍」的照片：全黑、全白、
 * 誤拍桌面、糊到看不出字、縮圖等級的解析度。這些是線上申請最常見的退件原因，
 * 而且全部可以用畫面本身的統計量判斷，不需要知道照片裡「是什麼」。
 *
 * 這一層刻意不做語意判斷——「這張是不是存摺封面」「有沒有傳錯格子」
 * 要靠文字辨識才知道，屬於之後的第三層。這裡只回答「這張圖能不能看」。
 *
 * 三個設計前提：
 *
 * 1. 只在瀏覽器裡算，檔案不會為了被檢查而多送一趟。證件照不該為了品管外流。
 * 2. 判讀失敗一律放行（fail-open）。解碼不出來、瀏覽器太舊、canvas 被隱私設定
 *    擋住——這些都不是使用者的錯，不能因此擋住一份合法申請。
 * 3. 結果是提示不是否決。呼叫端必須留給使用者「我就是要傳」的出路，
 *    這也是計畫書寫的原則：規則輸出只作為提示，不取代行政判斷。
 *
 * PDF 不在這一層的範圍內（瀏覽器沒有內建的 PDF 解碼器），直接回 skipped。
 */
(function (root) {
  'use strict';

  /**
   * 判讀門檻。
   *
   * 數值是拿合成的發票、存摺封面、身分證樣本（含各級高斯模糊）量出來的，
   * 取「絕不誤判真文件」那一側：每個門檻與最差的清晰樣本之間至少留 3 倍距離。
   * 代價是中等程度的模糊抓不到——那種照片還讀得出字，本來就該由承辦人決定。
   */
  var LIMITS = {
    /** 長邊像素下限。手機直拍最少也有 3000px，低於這個數多半是截圖或縮圖。 */
    minLongEdge: 640,
    /** 灰階標準差下限。低於這個值等於整張圖是同一個顏色。 */
    minStdDev: 4,
    /** 分塊銳利度下限，見 tileSharpness()。 */
    minSharpness: 300,
    /** 平均亮度的合理區間。 */
    minMean: 40,
    /** 接近純白的像素比例上限。超過代表閃光燈打死或對著光源拍。 */
    maxClipRatio: 0.6,
  };

  /** 統計時把長邊縮到這個尺寸，讓不同解析度的照片算出來可以互相比較。 */
  var WORK_LONG_EDGE = 512;

  /** 分塊銳利度的格數。8×8 在 512px 上每塊 64px，夠大到算得出邊緣。 */
  var TILES = 8;

  /** 銳利度取最清楚的前幾格平均，見 tileSharpness()。 */
  var SHARPEST_TILES = 3;

  /**
   * 算出一張灰階圖的基本統計量。
   *
   * @param {Uint8ClampedArray|number[]} gray 每像素一個 0–255 的值
   */
  function describe(gray, width, height) {
    var n = gray.length;
    var sum = 0;
    var clipped = 0;
    for (var i = 0; i < n; i++) {
      sum += gray[i];
      if (gray[i] >= 250) clipped++;
    }
    var mean = sum / n;

    var sq = 0;
    for (var j = 0; j < n; j++) {
      var d = gray[j] - mean;
      sq += d * d;
    }

    return {
      width: width,
      height: height,
      mean: mean,
      stdDev: Math.sqrt(sq / n),
      clipRatio: clipped / n,
    };
  }

  /**
   * 銳利度：把畫面切成格子，每格各算一次 Laplacian 變異數，取最高的前三格平均。
   *
   * 為什麼不直接算整張的變異數——存摺封面有九成面積是空白，整張一起算會被
   * 空白稀釋，數值掉到和「糊掉的發票」同一個量級，清晰的存摺就被誤判成模糊。
   * 改成問「這張圖裡最清楚的地方有多清楚」，才是我們真正想知道的：
   * 相機到底有沒有對到焦。
   *
   * 取前三格而不是最高那一格，是因為單一格太容易被意外的高頻訊號帶偏——
   * 一根入鏡的手指邊緣、一塊 JPEG 壓縮的方格雜訊，都足以讓整張糊照過關。
   * 也不取百分位：文件的字可能只集中在一小塊（例如只有三行字的證明書），
   * 那時連第 90 百分位都還落在空白區，稀疏但清晰的文件會被誤判。
   *
   * 合成樣本實測（發票／存摺／身分證／稀疏證明，各含高斯模糊對照組）：
   * 清晰的最低 2154，糊到不能看的最高 78，門檻 300 落在中間。
   */
  function tileSharpness(gray, width, height) {
    var tw = Math.floor(width / TILES);
    var th = Math.floor(height / TILES);
    // 格子小於 8px 就算不出有意義的邊緣，退回整張一起算。
    if (tw < 8 || th < 8) {
      tw = width;
      th = height;
    }

    var values = [];
    for (var ty = 0; ty + th <= height; ty += th) {
      for (var tx = 0; tx + tw <= width; tx += tw) {
        var sum = 0;
        var sumSq = 0;
        var count = 0;
        var yEnd = Math.min(ty + th, height - 1);
        var xEnd = Math.min(tx + tw, width - 1);
        for (var y = Math.max(1, ty); y < yEnd; y++) {
          for (var x = Math.max(1, tx); x < xEnd; x++) {
            var i = y * width + x;
            var lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
            sum += lap;
            sumSq += lap * lap;
            count++;
          }
        }
        if (count < 16) continue;
        var m = sum / count;
        values.push(sumSq / count - m * m);
      }
    }

    if (!values.length) return 0;
    values.sort(function (a, b) { return b - a; });

    var take = Math.min(SHARPEST_TILES, values.length);
    var total = 0;
    for (var k = 0; k < take; k++) total += values[k];
    return total / take;
  }

  /**
   * 把統計量翻成給使用者看的判斷。
   *
   * 一次只回報一個問題，照「使用者最該先處理哪一個」排序：解析度不夠重拍也沒用，
   * 全黑全白代表根本沒拍到東西，這兩個排在模糊前面。同時列出三個問題只會讓人
   * 不知道要改什麼。
   *
   * @returns {{ ok: boolean, code?: string, message?: string, hint?: string, stats: object }}
   */
  function judge(stats) {
    var longEdge = Math.max(stats.width, stats.height);

    if (longEdge < LIMITS.minLongEdge) {
      return reject('too-small', '這張圖只有 ' + stats.width + '×' + stats.height + ' 像素，審查時會看不清楚欄位。',
        '請用手機相機直接拍原始照片，不要用截圖或壓縮過的圖片。', stats);
    }
    if (stats.stdDev < LIMITS.minStdDev) {
      return reject('blank', '整張圖幾乎是同一個顏色，看不出文件內容。',
        '可能是誤拍到桌面或牆面、鏡頭被遮住，請重拍一張。', stats);
    }
    if (stats.clipRatio > LIMITS.maxClipRatio) {
      return reject('overexposed', '畫面過亮，大部分區域已經白掉。',
        '請避開直射光源或關掉閃光燈，換個角度重拍。', stats);
    }
    if (stats.mean < LIMITS.minMean) {
      return reject('too-dark', '畫面太暗，辨識不出文件上的字。',
        '請在光線足夠的地方重拍。', stats);
    }
    if (stats.sharpness < LIMITS.minSharpness) {
      return reject('blurry', '照片模糊，文件上的字看不清楚。',
        '請把手機拿穩、等對焦完成再按快門。', stats);
    }
    return { ok: true, stats: stats };
  }

  function reject(code, message, hint, stats) {
    return { ok: false, code: code, message: message, hint: hint, stats: stats };
  }

  /**
   * 把 ImageData 轉成灰階陣列。
   *
   * 用 BT.601 的亮度權重而不是三通道平均——人眼對綠色最敏感，平均值會讓
   * 紅色印章、藍色存摺封面這類有色文件的對比被低估。
   */
  function toGray(data, length) {
    var gray = new Uint8ClampedArray(length);
    for (var i = 0; i < length; i++) {
      var p = i * 4;
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return gray;
  }

  /**
   * 檢查一個使用者選的檔案。
   *
   * 非影像（PDF）與任何解碼失敗都回 `{ skipped: true }`，呼叫端應視同通過。
   *
   * @param {Blob} file
   * @returns {Promise<object>}
   */
  async function inspect(file) {
    if (!file || typeof file.type !== 'string' || file.type.indexOf('image/') !== 0) {
      return { ok: true, skipped: true, reason: 'not-an-image' };
    }
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      return { ok: true, skipped: true, reason: 'unsupported' };
    }

    var bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (error) {
      return { ok: true, skipped: true, reason: 'decode-failed' };
    }

    try {
      var scale = Math.min(1, WORK_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));

      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      // willReadFrequently 讓瀏覽器把畫布放在 CPU 記憶體，省下一次 GPU 回讀。
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: true, skipped: true, reason: 'no-context' };
      ctx.drawImage(bitmap, 0, 0, w, h);

      var pixels = ctx.getImageData(0, 0, w, h).data;
      var gray = toGray(pixels, w * h);

      // 尺寸門檻要看原圖，不是縮過的工作尺寸。
      var stats = describe(gray, bitmap.width, bitmap.height);
      stats.sharpness = tileSharpness(gray, w, h);
      return judge(stats);
    } catch (error) {
      // getImageData 會在某些隱私設定下丟 SecurityError。不確定就放行。
      return { ok: true, skipped: true, reason: 'measure-failed' };
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  var api = {
    LIMITS: LIMITS,
    WORK_LONG_EDGE: WORK_LONG_EDGE,
    describe: describe,
    tileSharpness: tileSharpness,
    judge: judge,
    toGray: toGray,
    inspect: inspect,
  };

  root.UploadImageCheck = api;
  // 讓 node:test 直接載入純函式部分做驗證，瀏覽器走上面那行。
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
