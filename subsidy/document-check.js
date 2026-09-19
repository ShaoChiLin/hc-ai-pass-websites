/**
 * 文件正確性預檢（第二層）。
 *
 * 第一層 image-check.js 只回答「這張圖能不能看」。這一層回答比較接近承辦人會問的
 * 「這是不是傳對欄位、有沒有看得到必要線索」。沒有把檔案多送到第三方 OCR 服務；
 * 能在本機讀到 PDF 文字層就用文字層，影像則用版面與檔名線索做保守判斷。
 *
 * 設計上仍然 fail-open：結果只是上傳前提示，不取代人工審查，也不阻擋使用者送件。
 */
(function (root) {
  'use strict';

  var DOC_PROFILES = {
    '身分證明': {
      label: '國民身分證正反面',
      keywords: ['身分證', '身分證明', '國民身分證', '身分證字號', 'id card', 'identity', 'identification'],
      antiKeywords: ['發票', '收據', '存摺', '帳戶', '低收入'],
      hint: '請確認上傳的是國民身分證正反面，且姓名、出生年月日與身分證字號都清楚可見。',
    },
    '購買憑證': {
      label: '統一發票或收據',
      keywords: ['發票', '收據', 'invoice', 'receipt', '統一編號', '買受人', '金額', '總計', '合計', '日期'],
      antiKeywords: ['身分證', '存摺', '帳戶', '低收入'],
      hint: '請確認憑證上看得到購買日期、品項、金額，以及申請人或可供核對的抬頭資訊。',
    },
    '帳戶資料': {
      label: '存摺封面影本',
      keywords: ['存摺', '銀行', '郵局', '帳號', '戶名', '分行', 'bank', 'account', 'passbook'],
      antiKeywords: ['身分證', '發票', '收據', '低收入'],
      hint: '請確認存摺封面看得到戶名、金融機構名稱或代號，以及完整帳號。',
    },
    '低收入戶證明': {
      label: '低收入戶或中低收入戶證明',
      keywords: ['低收入', '中低收入', '證明', '社會處', '區公所', '有效期間', 'low income'],
      antiKeywords: ['身分證', '發票', '收據', '存摺'],
      hint: '請確認證明文件有效期間涵蓋申請日，且姓名與申請人一致。',
    },
  };

  var PDF_TEXT_LIMIT = 220000;

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[._\-()[\]{}]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function keywordHits(text, keywords) {
    var normalized = normalizeText(text);
    return keywords.filter(function (word) {
      return normalized.indexOf(normalizeText(word)) !== -1;
    });
  }

  function hasTaiwanId(text) {
    return /[a-z][1289]\d{8}/i.test(String(text || '').replace(/\s+/g, ''));
  }

  function hasMoney(text) {
    return /(?:nt\$|新台幣|台幣|總計|合計|金額|[\$＄])\s*[0-9,]{2,}/i.test(text) ||
      /[0-9,]{3,}\s*(?:元|圓)/.test(text);
  }

  function hasDate(text) {
    return /(?:20\d{2}|11\d|10\d)[/.年-]\s?\d{1,2}(?:[/.月-]\s?\d{1,2})?/.test(text);
  }

  function hasAccount(text) {
    return /(?:帳號|account|戶號)[^\d]{0,8}\d[\d\s-]{5,}/i.test(text) ||
      /(?:銀行|郵局|分行)[\s\S]{0,60}\d[\d\s-]{6,}/.test(text);
  }

  function percentDecodeLoose(text) {
    return text.replace(/%([0-9a-f]{2})/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }

  function decodeUtf16Hex(hex) {
    var bytes = [];
    for (var i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    var start = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    var out = '';
    for (var j = start; j + 1 < bytes.length; j += 2) {
      out += String.fromCharCode(bytes[j] * 256 + bytes[j + 1]);
    }
    return out;
  }

  function extractPdfTextFromBytes(bytes) {
    if (!bytes || !bytes.length) return '';
    var slice = bytes.length > PDF_TEXT_LIMIT ? bytes.slice(0, PDF_TEXT_LIMIT) : bytes;
    var utf8 = '';
    var latin1 = '';

    try {
      utf8 = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    } catch (error) {
      utf8 = '';
    }
    try {
      latin1 = new TextDecoder('latin1', { fatal: false }).decode(slice);
    } catch (error) {
      latin1 = '';
    }

    var text = percentDecodeLoose(utf8 + '\n' + latin1);
    var literalStrings = [];
    text.replace(/\(([^()]{2,160})\)/g, function (_, body) {
      literalStrings.push(body.replace(/\\([nrtbf()\\])/g, ' '));
      return '';
    });
    text.replace(/<\s*(feff[0-9a-f\s]{8,600})\s*>/gi, function (_, hex) {
      literalStrings.push(decodeUtf16Hex(hex.replace(/\s+/g, '')));
      return '';
    });

    return (text + '\n' + literalStrings.join('\n')).replace(/[^\S\r\n]+/g, ' ');
  }

  function imageLayoutEvidence(stats) {
    if (!stats) return [];
    var evidence = [];
    var ratio = stats.width && stats.height ? Math.max(stats.width, stats.height) / Math.min(stats.width, stats.height) : 0;

    if (ratio > 1.45 && ratio < 1.85) evidence.push('card-ratio');
    if (ratio > 1.15 && ratio < 1.6 && stats.foregroundRatio > 0.04 && stats.foregroundRatio < 0.45) evidence.push('document-page');
    if (stats.edgeDensity > 0.055) evidence.push('text-like-edges');
    if (stats.blueRatio > 0.08) evidence.push('blue-document');

    return evidence;
  }

  function evaluateEvidence(docType, evidence) {
    var profile = DOC_PROFILES[docType];
    if (!profile) return { ok: true, skipped: true, reason: 'unknown-doc-type' };

    var sourceText = [
      evidence.fileName,
      evidence.pdfText,
      evidence.manualText,
    ].join('\n');
    var expectedHits = keywordHits(sourceText, profile.keywords);
    var antiHits = keywordHits(sourceText, profile.antiKeywords);
    var layout = imageLayoutEvidence(evidence.imageStats);
    var checks = [];

    if (expectedHits.length) checks.push('文字線索：' + expectedHits.slice(0, 4).join('、'));
    if (layout.length) checks.push('影像版面：' + layout.join('、'));

    var ok = expectedHits.length > 0;
    if (docType === '身分證明') ok = ok || hasTaiwanId(sourceText) || layout.indexOf('card-ratio') !== -1;
    if (docType === '購買憑證') {
      var receiptFields = [];
      if (hasMoney(sourceText)) receiptFields.push('金額');
      if (hasDate(sourceText)) receiptFields.push('日期');
      if (receiptFields.length) checks.push('憑證欄位：' + receiptFields.join('、'));
      ok = ok && (receiptFields.length > 0 || layout.indexOf('text-like-edges') !== -1);
    }
    if (docType === '帳戶資料') {
      if (hasAccount(sourceText)) checks.push('帳戶欄位：帳號或金融機構線索');
      ok = ok || hasAccount(sourceText) || layout.indexOf('blue-document') !== -1;
    }
    if (docType === '低收入戶證明') {
      if (hasDate(sourceText)) checks.push('證明欄位：日期或有效期間線索');
      ok = ok && (hasDate(sourceText) || sourceText.length < 20);
    }

    if (antiHits.length && !expectedHits.length) {
      return warn(
        'type-mismatch',
        '這份檔案比較像「' + antiHits[0] + '」相關文件，可能不是「' + profile.label + '」。',
        profile.hint,
        checks
      );
    }

    if (!ok) {
      return warn(
        'insufficient-evidence',
        '目前找不到足夠線索確認這是「' + profile.label + '」。',
        profile.hint,
        checks
      );
    }

    return {
      ok: true,
      code: 'matched',
      message: '文件線索符合「' + profile.label + '」。',
      hint: checks.length ? checks.join('；') : '已通過文件類型預檢。',
      checks: checks,
    };
  }

  function warn(code, message, hint, checks) {
    return {
      ok: false,
      code: code,
      message: message,
      hint: hint,
      checks: checks || [],
    };
  }

  function toGray(data, length) {
    var gray = new Uint8ClampedArray(length);
    for (var i = 0; i < length; i++) {
      var p = i * 4;
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return gray;
  }

  function measureImageData(pixels, width, height) {
    var gray = toGray(pixels, width * height);
    var edges = 0;
    var foreground = 0;
    var blue = 0;

    for (var y = 1; y < height - 1; y++) {
      for (var x = 1; x < width - 1; x++) {
        var i = y * width + x;
        var gx = Math.abs(gray[i - 1] - gray[i + 1]);
        var gy = Math.abs(gray[i - width] - gray[i + width]);
        if (gx + gy > 42) edges++;
      }
    }

    for (var p = 0; p < width * height; p++) {
      var o = p * 4;
      var r = pixels[o];
      var g = pixels[o + 1];
      var b = pixels[o + 2];
      if (gray[p] < 210) foreground++;
      if (b > r + 24 && b > g + 8) blue++;
    }

    var inner = Math.max(1, (width - 2) * (height - 2));
    var total = Math.max(1, width * height);
    return {
      width: width,
      height: height,
      edgeDensity: edges / inner,
      foregroundRatio: foreground / total,
      blueRatio: blue / total,
    };
  }

  async function inspectImage(file) {
    if (!file || typeof file.type !== 'string' || file.type.indexOf('image/') !== 0) return null;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

    var bitmap;
    try {
      bitmap = await createImageBitmap(file);
      var scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      return measureImageData(ctx.getImageData(0, 0, w, h).data, w, h);
    } catch (error) {
      return null;
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  async function inspectPdf(file) {
    if (!file || file.type !== 'application/pdf' || typeof file.arrayBuffer !== 'function') return '';
    try {
      return extractPdfTextFromBytes(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      return '';
    }
  }

  async function inspect(docType, file, context) {
    var evidence = {
      fileName: file && file.name,
      manualText: [
        context && context.applicantName,
        context && context.bankCode,
        context && context.bankAccount,
      ].join('\n'),
      pdfText: await inspectPdf(file),
      imageStats: await inspectImage(file),
    };
    return evaluateEvidence(docType, evidence);
  }

  var api = {
    DOC_PROFILES: DOC_PROFILES,
    normalizeText: normalizeText,
    keywordHits: keywordHits,
    extractPdfTextFromBytes: extractPdfTextFromBytes,
    measureImageData: measureImageData,
    imageLayoutEvidence: imageLayoutEvidence,
    evaluateEvidence: evaluateEvidence,
    inspect: inspect,
  };

  root.UploadDocumentCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
