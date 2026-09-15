/**
 * 補助申請頁。
 *
 * 七個步驟：申請須知 → 資格預檢 → 資安宣導 → 填申請書 → 應備文件 → 確認送出 → 收件回執。
 *
 * 幾個刻意的設計，改動前請先看完：
 *
 * 1. 案件編號一律由伺服器發。這一頁沒有任何產生編號的程式碼——以前有一份
 *    generateCaseNumber()，連不上伺服器時會發一個 HC-AI-YYMMDD-NNNN 的假編號，
 *    流程看起來走完了，但承辦端根本沒收到，申請人拿著那組編號去 LINE 也查不到。
 *    現在送不出去就是送不出去，停在確認頁並說明原因。
 *
 * 2. 補助比率、上限、受理期間、承辦窗口全部向伺服器要（GET /program），
 *    不在這裡寫死。下面的 FALLBACK_PROGRAM 只有在離線展示時才會用到，
 *    它必須跟著 server/src/program.js 一起改。
 *
 * 3. 身分證字號、金融帳號與門牌在這裡只做格式檢查，送出後伺服器也只留遮蔽碼。
 *    草稿暫存（localStorage）刻意不存這三個欄位——瀏覽器的 localStorage
 *    不是放證件號碼的地方。
 */

/* ---------------------------------------------------------------------------
 * 計畫資料
 *
 * ⚠️ 這份常數是 server/src/program.js 的鏡像，只在離線展示時使用。
 * 那邊改了數字，這邊要跟著改，否則離線畫面會和真的送出結果對不起來。
 * ------------------------------------------------------------------------- */

const FALLBACK_PROGRAM = {
  program: {
    name: '新竹市青年 AI 數位工具補助',
    legalBasis: '「新竹市青年 AI 數位工具補助作業要點」第四點、第六點（示範）',
    announcementNo: '竹市青字第 XXXXXXXXXX 號（示範）',
    intakeOpenAt: '2026-09-01',
    intakeCloseAt: '2026-11-30',
    reviewWorkingDays: 7,
    correctionDays: 14,
    ageMin: 18,
    ageMax: 35,
    householdCity: '新竹市',
    contact: {
      unit: '新竹市政府 青年事務科（示範）',
      phone: '03-XXX-XXXX 分機 XXX（示範）',
      email: 'youth@demo.invalid（示範）',
      hours: '週一至週五 08:30–12:00、13:30–17:30',
    },
    grants: {
      general: { label: '一般青年', rate: 0.5, cap: 3000 },
      lowincome: { label: '低收入戶／中低收入戶', rate: 0.9, cap: 6000 },
    },
  },
  documents: [
    { docType: '身分證明', label: '國民身分證正反面', note: '正反面請合併為一個 PDF 或一張照片後上傳。', required: true },
    { docType: '購買憑證', label: '統一發票或收據', note: '需可辨識品項、金額與日期；抬頭須為申請人本人。', required: true },
    { docType: '帳戶資料', label: '存摺封面影本', note: '戶名須為申請人本人，需可辨識金融機構代號與帳號。', required: true },
    { docType: '低收入戶證明', label: '低收入戶或中低收入戶證明', note: '僅申請 90% 補助者需檢附，有效期間需涵蓋申請日。', required: false, onlyFor: 'lowincome' },
  ],
  upload: {
    maxFileBytes: 5 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  },
};

/** 新竹市的行政區。和 server/src/identity.js 的 HSINCHU_DISTRICTS 必須一致。 */
const HSINCHU_DISTRICTS = ['東區', '北區', '香山區'];

const STEP_COUNT = 7;
const REQUIRED_WATCH_SECONDS = 20;

const state = {
  currentStep: 1,
  watchedSeconds: 0,
  watchComplete: false,
  demoTimer: null,
  securityComplete: false,
  /** GET /program 的結果；離線時是 FALLBACK_PROGRAM。 */
  meta: FALLBACK_PROGRAM,
  metaFromServer: false,
  /** 伺服器給的今天。跨日或伺服器時區不同時，年齡要以它為準。 */
  today: '',
  draftId: '',
  /** 已上傳的檔案，key 是 docType。 */
  files: {},
  submitting: false,
};

/* ---------------------------------------------------------------------------
 * DOM
 * ------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const panels = [...document.querySelectorAll('.step-panel')];
const steps = [...document.querySelectorAll('.step')];
const stepLines = [...document.querySelectorAll('.step-line')];
const stepper = $('stepper');

const nextBtn = $('nextBtn');
const nextBtnText = $('nextBtnText');
const backBtn = $('backBtn');
const footerStatus = $('footerStatus');
const toast = $('toast');

const apiDot = $('apiDot');
const apiStatus = $('apiStatus');
const apiConfigBtn = $('apiConfigBtn');

// Step 1
const consentPrivacy = $('consentPrivacy');
const consentTerms = $('consentTerms');

// Step 2
const birthInput = $('birthInput');
const ageHint = $('ageHint');
const cityInput = $('cityInput');
const districtRow = $('districtRow');
const districtInput = $('districtInput');
const noDuplicate = $('noDuplicate');
const eligibilityResult = $('eligibilityResult');
const eligibilityHeadline = $('eligibilityHeadline');
const eligibilityFailures = $('eligibilityFailures');

// Step 3
const video = $('awarenessVideo');
const videoPlaceholder = $('videoPlaceholder');
const demoPlayBtn = $('demoPlayBtn');
const watchTimer = $('watchTimer');
const watchProgress = $('watchProgress');
const watchLabel = $('watchLabel');
const securityChecks = [...document.querySelectorAll('.security-check')];
const securityResult = $('securityResult');

// Step 4
const nameInput = $('nameInput');
const idInput = $('idInput');
const idHint = $('idHint');
const phoneInput = $('phoneInput');
const emailInput = $('emailInput');
const residenceCity = $('residenceCity');
const residenceDistrict = $('residenceDistrict');
const residenceDetail = $('residenceDetail');
const mailingSame = $('mailingSame');
const mailingFields = $('mailingFields');
const mailingCity = $('mailingCity');
const mailingDistrict = $('mailingDistrict');
const mailingDetail = $('mailingDetail');
const bankCode = $('bankCode');
const bankAccount = $('bankAccount');
const bankHint = $('bankHint');
const bankSelf = $('bankSelf');
const qualificationRadios = [...document.querySelectorAll('input[name="qualification"]')];
const qualificationCards = [...document.querySelectorAll('.qual-card')];
const toolInput = $('toolInput');
const amountInput = $('amountInput');
const estimateRule = $('estimateRule');
const estimateAmount = $('estimateAmount');

// Step 5
const uploadLimitNote = $('uploadLimitNote');
const uploadList = $('uploadList');
const uploadOffline = $('uploadOffline');

// Step 6
const review = $('review');
const submitError = $('submitError');
const submitErrorText = $('submitErrorText');
const finalConfirm = $('finalConfirm');

// Step 7
const caseNumber = $('caseNumber');
const copyCaseBtn = $('copyCaseBtn');
const receiptProgram = $('receiptProgram');
const receivedAt = $('receivedAt');
const receiptStatus = $('receiptStatus');
const reviewDue = $('reviewDue');
const receiptTool = $('receiptTool');
const receiptGrant = $('receiptGrant');
const receiptDocs = $('receiptDocs');
const receiptMissing = $('receiptMissing');
const receiptContact = $('receiptContact');
const printBtn = $('printBtn');
const restartBtn = $('restartBtn');

/* ---------------------------------------------------------------------------
 * 小工具
 * ------------------------------------------------------------------------- */

function formatMoney(value) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace('TWD', 'NT$');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 檔名與使用者填的字串都會進 innerHTML，一律先跳脫。 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

/** 今天（台北時間）。伺服器連得上時以伺服器的為準，跨日時兩邊才不會差一天。 */
function today() {
  if (state.today) return state.today;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

/* ---------------------------------------------------------------------------
 * 資格檢核（server/src/program.js 的 checkEligibility 鏡像）
 *
 * 這一份是給使用者看的即時回饋，不是安全機制——真正擋下來的是伺服器那一份。
 * 兩邊的 code 與訊息刻意寫成一樣，這樣送出被退回時，使用者看到的是同一句話。
 * ------------------------------------------------------------------------- */

function isRealDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** 足歲年齡。用年份差再判斷生日到了沒，不是天數除以 365。 */
function ageOn(birthDate, onDate) {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const target = new Date(`${onDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(target.getTime())) return NaN;

  let age = target.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = target.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && target.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function readEligibilityInput() {
  const city = cityInput.value === '__other__' ? '其他縣市' : cityInput.value;
  return {
    birthDate: birthInput.value,
    householdCity: city,
    district: districtInput.value,
    noDuplicate: noDuplicate.checked,
    consentPrivacy: consentPrivacy.checked,
    consentTerms: consentTerms.checked,
  };
}

function checkEligibility() {
  const input = readEligibilityInput();
  const p = state.meta.program;
  const failures = [];
  const push = (code, message) => failures.push({ code, message });
  const now = today();

  let age = NaN;
  if (!isRealDate(input.birthDate)) {
    push('birthDate', '請填寫正確的出生年月日。');
  } else if (input.birthDate > now) {
    push('birthDate', '出生年月日不能晚於今天。');
  } else {
    age = ageOn(input.birthDate, now);
    if (age < p.ageMin || age > p.ageMax) {
      push('age', `本計畫補助對象為申請當日年滿 ${p.ageMin} 歲至 ${p.ageMax} 歲之青年，您目前為 ${age} 歲，不符合資格。`);
    }
  }

  if (input.householdCity !== p.householdCity) {
    push('householdCity', `本計畫限設籍${p.householdCity}之青年申請。`);
  } else if (!input.district) {
    push('district', '請選擇戶籍行政區。');
  }

  if (!input.noDuplicate) push('noDuplicate', '須切結未就同一項目重複請領其他機關補助，始得申請。');
  if (!input.consentPrivacy) push('consentPrivacy', '須閱讀並同意個人資料蒐集告知事項，始得申請。');
  if (!input.consentTerms) push('consentTerms', '須閱讀並同意申請須知及切結事項，始得申請。');

  return { ok: failures.length === 0, age, failures };
}

/* ---------------------------------------------------------------------------
 * 身分欄位（server/src/identity.js 的鏡像）
 *
 * 同樣只是即時回饋。這裡算得出檢查碼，是為了讓使用者在按下送出之前
 * 就知道自己打錯了一碼，而不是送出去被伺服器退回來。
 * ------------------------------------------------------------------------- */

const LETTER_VALUES = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
  K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
  U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

// 1／2 是國民的性別碼；8／9 是 2021 年換發的新式外來人口統一證號。
const SECOND_DIGITS = new Set(['1', '2', '8', '9']);

function validateNationalId(input) {
  const id = String(input ?? '').trim().toUpperCase();

  if (!/^[A-Z][0-9]{9}$/.test(id)) {
    return { ok: false, error: '身分證字號格式不正確（1 碼英文 + 9 碼數字）。' };
  }
  if (!SECOND_DIGITS.has(id[1])) {
    return { ok: false, error: '身分證字號第 2 碼只能是 1、2、8 或 9。' };
  }

  const value = LETTER_VALUES[id[0]];
  let sum = Math.floor(value / 10) + (value % 10) * 9;
  for (let i = 1; i <= 8; i += 1) sum += Number(id[i]) * (9 - i);
  sum += Number(id[9]);

  if (sum % 10 !== 0) return { ok: false, error: '身分證字號檢查碼不正確，請再確認一次。' };

  return { ok: true, masked: `${id.slice(0, 3)}****${id.slice(7)}`, value: id };
}

function validateBankAccount(code, account) {
  const bankNo = String(code ?? '').trim();
  const number = String(account ?? '').replace(/[\s-]/g, '');

  if (!/^\d{3}$/.test(bankNo)) return { ok: false, error: '金融機構代號必須是 3 碼數字。' };
  if (!/^\d{10,16}$/.test(number)) return { ok: false, error: '帳號必須是 10 到 16 碼數字。' };

  const masked = `${bankNo}-${'*'.repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`;
  return { ok: true, masked, code: bankNo, account: number };
}

function validateEmail(input) {
  const email = String(input ?? '').trim();
  if (email.length > 100) return { ok: false, error: '電子郵件過長。' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '電子郵件格式不正確。' };
  return { ok: true, value: email };
}

/* ---------------------------------------------------------------------------
 * 收件伺服器
 *
 * 這一頁是 GitHub Pages 上的靜態頁，收件的 Express 跑在承辦端的電腦上、透過 ngrok
 * 對外。ngrok 每次重開網址都會變，所以位址不能寫死：用 ?api=https://xxx.ngrok-free.app
 * 帶進來，存進 localStorage，之後回訪就不必再帶一次。
 * ------------------------------------------------------------------------- */

const API_STORAGE_KEY = 'hc-ai-pass.apiBase';
const DRAFT_STORAGE_KEY = 'hc-ai-pass.subsidyDraft';

/** ngrok 免費版預設會先回一頁 HTML 攔截頁（ERR_NGROK_6024），這個標頭是官方指定的跳過方式。 */
const NGROK_HEADER = { 'ngrok-skip-browser-warning': '1' };

function normalizeApiBase(value) {
  const base = String(value ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/.test(base) ? base : '';
}

function readApiBase() {
  try {
    return normalizeApiBase(localStorage.getItem(API_STORAGE_KEY));
  } catch {
    // 無痕模式可能讀不到 localStorage。這時只是回到離線模式，不該讓整頁壞掉。
    return '';
  }
}

function saveApiBase(value) {
  const base = normalizeApiBase(value);
  try {
    if (base) localStorage.setItem(API_STORAGE_KEY, base);
    else localStorage.removeItem(API_STORAGE_KEY);
  } catch {}
  renderApiStatus();
  return base;
}

function renderApiStatus() {
  const base = readApiBase();
  apiDot.classList.toggle('online', Boolean(base));
  apiStatus.textContent = base ? `已連線：${base.replace(/^https?:\/\//, '')}` : '離線展示模式';
  uploadOffline.hidden = Boolean(base);
}

/* ---------------------------------------------------------------------------
 * 計畫資訊
 * ------------------------------------------------------------------------- */

async function loadProgram() {
  const base = readApiBase();
  if (!base) {
    renderProgram();
    return;
  }

  try {
    const response = await fetch(`${base}/api/applications/program`, { headers: NGROK_HEADER });
    if (!response.ok) throw new Error(`伺服器回應 ${response.status}`);

    const data = await response.json();
    state.meta = { program: data.program, documents: data.documents, upload: data.upload };
    state.today = data.today || '';
    state.metaFromServer = true;
  } catch (error) {
    // 拿不到就用內建的那份。這時候畫面上的數字可能和承辦端不一致，所以講出來。
    console.warn('取得計畫資訊失敗，改用內建資料：', error.message);
    showToast('連不上收件伺服器，改用離線資料顯示');
  }

  renderProgram();
  syncFromDom();
}

function renderProgram() {
  const p = state.meta.program;

  $('factLegalBasis').textContent = p.legalBasis;
  $('factAnnouncement').textContent = p.announcementNo;
  $('factWindow').textContent = `${p.intakeOpenAt} 至 ${p.intakeCloseAt}`;
  $('factReviewDays').textContent = `收件後 ${p.reviewWorkingDays} 個上班日內完成形式審查`;
  $('factCorrection').textContent = `經通知補正者，應於 ${p.correctionDays} 日內補齊，逾期不予受理`;

  $('factEligibility').textContent =
    `設籍${p.householdCity}，且於申請當日年滿 ${p.ageMin} 歲至 ${p.ageMax} 歲之青年，` +
    '就同一項目未重複請領其他機關補助者。';

  $('grantTable').innerHTML = Object.entries(p.grants)
    .map(([, g]) => `
      <div class="grant-row">
        <strong>${escapeHtml(g.label)}</strong>
        <span>補助 ${Math.round(g.rate * 100)}%</span>
        <span>每人最高 ${formatMoney(g.cap)}</span>
      </div>`)
    .join('');

  $('docBrief').innerHTML = state.meta.documents
    .map((doc) => `
      <li>
        <strong>${escapeHtml(doc.label)}</strong>
        <span class="doc-tag">${doc.required ? '必備' : `${escapeHtml(p.grants[doc.onlyFor]?.label ?? '特定身分')}適用`}</span>
        <small>${escapeHtml(doc.note)}</small>
      </li>`)
    .join('');

  $('factUnit').textContent = p.contact.unit;
  $('factPhone').textContent = p.contact.phone;
  $('factEmail').textContent = p.contact.email;
  $('factHours').textContent = p.contact.hours;

  // 補助身分別卡片上的比率與上限也來自同一份資料，不再寫死在 HTML 裡。
  $('qualGeneralLabel').textContent = p.grants.general.label;
  $('qualGeneralRate').textContent = `補助 ${Math.round(p.grants.general.rate * 100)}%`;
  $('qualGeneralCap').textContent = `每人最高 ${formatMoney(p.grants.general.cap)}`;
  $('qualLowLabel').textContent = p.grants.lowincome.label;
  $('qualLowRate').textContent = `補助 ${Math.round(p.grants.lowincome.rate * 100)}%`;
  $('qualLowCap').textContent = `每人最高 ${formatMoney(p.grants.lowincome.cap)}`;

  const mb = Math.round(state.meta.upload.maxFileBytes / 1024 / 1024);
  uploadLimitNote.textContent = `支援 JPG、PNG、PDF，單檔最大 ${mb} MB。同一類文件再上傳一次視為替換。`;

  renderUploadList();
}

/** 這次申請需要哪些文件。低收證明只有申請 90% 的人要附。 */
function requiredDocuments() {
  const qualification = currentQualification();
  return state.meta.documents.filter((doc) => (doc.required ? true : doc.onlyFor === qualification));
}

function currentQualification() {
  return document.querySelector('input[name="qualification"]:checked')?.value ?? 'general';
}

/* ---------------------------------------------------------------------------
 * 申請書欄位檢核
 *
 * 回傳「缺哪些」而不是布林值：按鈕反灰卻不說原因，使用者只會一直捲上去找。
 * ------------------------------------------------------------------------- */

function applicationProblems() {
  const problems = [];
  const phone = phoneInput.value.replace(/\D/g, '');

  if (nameInput.value.trim().length < 2) problems.push('姓名');

  const id = validateNationalId(idInput.value);
  if (!id.ok) problems.push('身分證字號');

  // 09XX XXX XXX 和 0912-345-678 都是台灣人習慣的寫法，兩種都該過。
  if (!/^09\d{8}$/.test(phone)) problems.push('行動電話');
  if (!validateEmail(emailInput.value).ok) problems.push('電子郵件');

  const detail = residenceDetail.value.trim();
  if (detail.length < 3 || detail.length > 80) problems.push('戶籍詳細地址');

  if (!mailingSame.checked) {
    if (mailingCity.value.trim().length < 2) problems.push('通訊地址縣市');
    if (mailingDistrict.value.trim().length < 1) problems.push('通訊地址鄉鎮市區');
    const md = mailingDetail.value.trim();
    if (md.length < 3 || md.length > 80) problems.push('通訊詳細地址');
  }

  if (!validateBankAccount(bankCode.value, bankAccount.value).ok) problems.push('撥款帳戶');
  if (!bankSelf.checked) problems.push('帳戶戶名切結');

  const tool = toolInput.value.trim();
  if (tool.length < 2 || tool.length > 60) problems.push('工具名稱');
  if (!(Number(amountInput.value) > 0)) problems.push('購買金額');

  return problems;
}

function calculateEstimate() {
  const grants = state.meta.program.grants;
  const grant = grants[currentQualification()] ?? grants.general;
  const amount = Math.max(0, Number(amountInput.value) || 0);

  estimateRule.textContent =
    `${grant.label}｜${Math.round(grant.rate * 100)}%，最高 ${formatMoney(grant.cap)}`;
  estimateAmount.textContent = formatMoney(Math.floor(Math.min(amount * grant.rate, grant.cap)));
}

/* ---------------------------------------------------------------------------
 * 步驟切換
 * ------------------------------------------------------------------------- */

/**
 * 這一步能不能往下走，以及腳注要說什麼。
 *
 * 每一步都自己回答這三件事，updateFooter() 就不必長成一串 if-else。
 */
function gateFor(step) {
  if (step === 1) {
    const ok = consentPrivacy.checked && consentTerms.checked;
    return {
      ok,
      cta: '前往資格預檢',
      hint: ok ? '已同意告知事項，可以繼續' : '請閱讀並勾選兩項同意事項',
    };
  }

  if (step === 2) {
    const result = checkEligibility();
    return {
      ok: result.ok,
      cta: '進入資安宣導',
      hint: result.ok ? '資格預檢通過，可以繼續' : result.failures[0].message,
    };
  }

  if (step === 3) {
    const ok = state.watchComplete && state.securityComplete;
    let hint = '已完成宣導與檢核，可以繼續';
    if (!state.watchComplete) hint = '請先完成 20 秒資安宣導';
    else if (!state.securityComplete) hint = '請完成 AI 安全三問';
    return { ok, cta: '填寫申請書', hint };
  }

  if (step === 4) {
    const problems = applicationProblems();
    return {
      ok: problems.length === 0,
      cta: '檢附應備文件',
      hint: problems.length === 0 ? '申請書已填寫完成' : `尚缺或格式有誤：${problems.join('、')}`,
    };
  }

  if (step === 5) {
    // 缺件不擋送出。政府流程是先收件、再形式審查，缺的走補正。
    const missing = requiredDocuments().filter((doc) => !state.files[doc.docType]);
    return {
      ok: true,
      cta: '確認申請內容',
      hint: missing.length === 0
        ? '應備文件已檢附齊全'
        : `尚未上傳 ${missing.length} 件，仍可送出，後續將通知補正`,
    };
  }

  if (step === 6) {
    return {
      ok: finalConfirm.checked,
      cta: '確認送出',
      hint: finalConfirm.checked ? '按下送出後即完成收件' : '請勾選確認後送出',
    };
  }

  return { ok: false, cta: '', hint: '申請已完成' };
}

function updateStepper() {
  steps.forEach((step, index) => {
    const num = index + 1;
    step.classList.toggle('active', num === state.currentStep);
    step.classList.toggle('done', num < state.currentStep);
    step.querySelector('.step-dot').textContent = num < state.currentStep ? '✓' : num;
  });

  stepLines.forEach((line, index) => {
    line.classList.toggle('done', index + 1 < state.currentStep);
  });

  // 七個步驟在手機上放不下，所以要把目前這一格捲進視野。
  // 用 scrollTo 而不是 scrollIntoView——後者會連帶把整頁往下捲。
  const active = steps[state.currentStep - 1];
  if (active && stepper.scrollWidth > stepper.clientWidth) {
    stepper.scrollTo({
      left: active.offsetLeft - stepper.clientWidth / 2 + active.offsetWidth / 2,
      behavior: 'smooth',
    });
  }
}

function updatePanels() {
  panels.forEach((panel, index) => {
    panel.classList.toggle('active', index + 1 === state.currentStep);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateFooter() {
  if (state.currentStep === STEP_COUNT) {
    nextBtn.style.display = 'none';
    backBtn.hidden = true;
    footerStatus.textContent = '申請已完成';
    return;
  }

  const gate = gateFor(state.currentStep);
  nextBtn.style.display = 'flex';
  backBtn.hidden = state.currentStep === 1;

  if (state.submitting) {
    nextBtn.disabled = true;
    nextBtnText.textContent = '送出中…';
    footerStatus.textContent = '正在送往收件伺服器';
    return;
  }

  nextBtn.disabled = !gate.ok;
  nextBtnText.textContent = gate.cta;
  footerStatus.textContent = gate.hint;
}

function goToStep(step) {
  state.currentStep = Math.min(STEP_COUNT, Math.max(1, step));

  // 進入某幾步之前要先把資料帶過去，否則使用者看到的是上一次的內容。
  if (state.currentStep === 4) carryEligibilityIntoForm();
  if (state.currentStep === 5) renderUploadList();
  if (state.currentStep === 6) renderReview();

  updateStepper();
  updatePanels();
  updateFooter();
  saveDraft();
}

/** 把資格預檢填的縣市與行政區帶進申請書。伺服器會比對兩者是否一致。 */
function carryEligibilityIntoForm() {
  const input = readEligibilityInput();
  residenceCity.value = input.householdCity;
  residenceDistrict.value = input.district;
}

/* ---------------------------------------------------------------------------
 * 應備文件上傳
 * ------------------------------------------------------------------------- */

/** 檔頭的魔術位元組。副檔名與瀏覽器給的 MIME 都可能是錯的，只有內容不會騙人。 */
const SIGNATURES = [
  { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

function sniffType(bytes) {
  if (!bytes || bytes.length < 8) return null;
  return SIGNATURES.find((sig) => sig.magic.every((byte, i) => bytes[i] === byte)) ?? null;
}

function renderUploadList() {
  const docs = requiredDocuments();

  uploadList.innerHTML = docs
    .map((doc) => {
      const file = state.files[doc.docType];
      const done = Boolean(file);
      return `
        <div class="upload-item ${done ? 'ok' : ''}" data-doc="${escapeHtml(doc.docType)}">
          <div class="upload-copy">
            <strong>${escapeHtml(doc.label)}</strong>
            <span class="doc-tag">${doc.required ? '必備' : '低收／中低收適用'}</span>
            <small>${escapeHtml(doc.note)}</small>
            ${done
              ? `<div class="upload-file">📄 ${escapeHtml(file.displayName)}　${formatBytes(file.size)}</div>`
              : ''}
            <div class="upload-error" hidden></div>
          </div>
          <div class="upload-actions">
            <label class="ghost-btn upload-pick">
              ${done ? '重新上傳' : '選擇檔案'}
              <input type="file" accept="image/jpeg,image/png,application/pdf" hidden>
            </label>
            ${done ? '<button class="text-btn upload-remove" type="button">移除</button>' : ''}
          </div>
        </div>`;
    })
    .join('');

  uploadList.querySelectorAll('.upload-item').forEach((item) => {
    const docType = item.dataset.doc;
    item.querySelector('input[type="file"]').addEventListener('change', (event) => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) uploadDocument(docType, file, item);
    });
    item.querySelector('.upload-remove')?.addEventListener('click', () => removeDocument(docType));
  });
}

/** pending=true 代表這是「上傳中…」之類的狀態訊息，不是錯誤，顏色會不一樣。 */
function showUploadError(item, message, pending = false) {
  const box = item.querySelector('.upload-error');
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
  box.classList.toggle('pending', pending);
}

/** 確保有一份草稿可以放檔案。草稿過期會回 404，屆時重開一份。 */
async function ensureDraft(base) {
  if (state.draftId) return state.draftId;

  const response = await fetch(`${base}/api/applications/drafts`, {
    method: 'POST',
    headers: NGROK_HEADER,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `伺服器回應 ${response.status}`);

  state.draftId = data.draftId;
  return state.draftId;
}

async function uploadDocument(docType, file, item) {
  const base = readApiBase();
  showUploadError(item, '');

  if (!base) {
    showUploadError(item, '尚未連線到收件伺服器，無法上傳。可先送出，文件之後再補。');
    return;
  }

  const maxBytes = state.meta.upload.maxFileBytes;
  if (file.size > maxBytes) {
    showUploadError(item, `單一檔案不得超過 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
    return;
  }

  const buffer = await file.arrayBuffer();
  // 先在本機比對檔頭。送出去才被退回的話，使用者要等一趟網路來回才知道選錯檔。
  const sig = sniffType(new Uint8Array(buffer));
  if (!sig) {
    showUploadError(item, '只接受 JPG、PNG 或 PDF 檔。副檔名改掉不算數。');
    return;
  }

  showUploadError(item, '上傳中…', true);

  try {
    const draftId = await ensureDraft(base);
    const query = `docType=${encodeURIComponent(docType)}&filename=${encodeURIComponent(file.name)}`;

    const response = await fetch(`${base}/api/applications/drafts/${draftId}/files?${query}`, {
      method: 'POST',
      // 一個請求一個檔，body 就是檔案本身（伺服器端用 express.raw 收），不做 multipart。
      headers: { ...NGROK_HEADER, 'Content-Type': sig.mimeType },
      body: buffer,
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 404) {
      // 草稿過期了。清掉之後再試一次就會開一份新的。
      state.draftId = '';
      state.files = {};
      throw new Error('上傳暫存已過期，請再上傳一次。');
    }
    if (!response.ok) throw new Error(data.error || `伺服器回應 ${response.status}`);

    state.files[docType] = data.file;
    renderUploadList();
    updateFooter();
    saveDraft();
    showToast(data.replaced ? `已替換「${docType}」` : `已上傳「${docType}」`);
  } catch (error) {
    renderUploadList();
    const target = uploadList.querySelector(`.upload-item[data-doc="${CSS.escape(docType)}"]`);
    if (target) showUploadError(target, error.message);
  }
}

async function removeDocument(docType) {
  const base = readApiBase();
  const file = state.files[docType];
  if (!file) return;

  delete state.files[docType];
  renderUploadList();
  updateFooter();
  saveDraft();

  if (base && state.draftId) {
    // 刪不掉也不必打斷使用者——草稿有壽命，掃描器最後會把整份清掉。
    fetch(`${base}/api/applications/drafts/${state.draftId}/files/${file.fileId}`, {
      method: 'DELETE',
      headers: NGROK_HEADER,
    }).catch(() => {});
  }
}

/* ---------------------------------------------------------------------------
 * 確認頁
 * ------------------------------------------------------------------------- */

function reviewRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderReview() {
  const eligibility = checkEligibility();
  const input = readEligibilityInput();
  const id = validateNationalId(idInput.value);
  const bank = validateBankAccount(bankCode.value, bankAccount.value);
  const grants = state.meta.program.grants;
  const grant = grants[currentQualification()] ?? grants.general;
  const amount = Math.max(0, Number(amountInput.value) || 0);
  const approved = Math.floor(Math.min(amount * grant.rate, grant.cap));

  const residence = `${input.householdCity}${input.district}${residenceDetail.value.trim()}`;
  const mailing = mailingSame.checked
    ? '同戶籍地址'
    : `${mailingCity.value.trim()}${mailingDistrict.value.trim()}${mailingDetail.value.trim()}`;

  const docs = requiredDocuments();
  const attached = docs.filter((doc) => state.files[doc.docType]);
  const missing = docs.filter((doc) => !state.files[doc.docType]);

  // 確認頁顯示的是遮蔽碼，不是全碼。使用者常在公開場合或投影幕前走這一頁，
  // 而且他剛剛才輸入過，不需要再看一次完整號碼來確認。
  review.innerHTML = `
    <div class="review-group">
      <h3>資格</h3>
      <dl class="fact-list">
        ${reviewRow('出生年月日', `${input.birthDate}（申請當日 ${Number.isNaN(eligibility.age) ? '—' : eligibility.age} 歲）`)}
        ${reviewRow('戶籍縣市', input.householdCity)}
        ${reviewRow('切結事項', '未重複請領、已同意個資告知與申請須知')}
      </dl>
    </div>

    <div class="review-group">
      <h3>申請人</h3>
      <dl class="fact-list">
        ${reviewRow('姓名', nameInput.value.trim())}
        ${reviewRow('身分證字號', id.ok ? id.masked : '格式有誤')}
        ${reviewRow('行動電話', phoneInput.value.replace(/\D/g, ''))}
        ${reviewRow('電子郵件', emailInput.value.trim())}
        ${reviewRow('戶籍地址', residence)}
        ${reviewRow('通訊地址', mailing)}
        ${reviewRow('撥款帳戶', bank.ok ? `${bank.masked}（戶名為本人）` : '格式有誤')}
      </dl>
      <p class="review-note">身分證字號、帳號與門牌送到伺服器後只會保存遮蔽碼。</p>
    </div>

    <div class="review-group">
      <h3>補助內容</h3>
      <dl class="fact-list">
        ${reviewRow('補助身分別', grant.label)}
        ${reviewRow('工具名稱', toolInput.value.trim())}
        ${reviewRow('購買金額', formatMoney(amount))}
        ${reviewRow('預估補助金額', `${formatMoney(approved)}（${Math.round(grant.rate * 100)}%，上限 ${formatMoney(grant.cap)}）`)}
      </dl>
    </div>

    <div class="review-group">
      <h3>應備文件</h3>
      <ul class="review-docs">
        ${docs.map((doc) => {
          const file = state.files[doc.docType];
          return `<li class="${file ? 'ok' : 'missing'}">
            <span>${file ? '✓' : '○'}</span>
            <div>
              <strong>${escapeHtml(doc.label)}</strong>
              <small>${file ? `${escapeHtml(file.displayName)}　${formatBytes(file.size)}` : '尚未上傳，收件後將通知限期補正'}</small>
            </div>
          </li>`;
        }).join('')}
      </ul>
      <p class="review-note">已檢附 ${attached.length} 件，尚缺 ${missing.length} 件。缺件不影響收件時間。</p>
    </div>`;
}

/* ---------------------------------------------------------------------------
 * 送出
 * ------------------------------------------------------------------------- */

function buildPayload() {
  const input = readEligibilityInput();
  const bank = validateBankAccount(bankCode.value, bankAccount.value);

  return {
    draftId: state.draftId || undefined,
    eligibility: {
      birthDate: input.birthDate,
      householdCity: input.householdCity,
      noDuplicate: input.noDuplicate,
      consentPrivacy: input.consentPrivacy,
      consentTerms: input.consentTerms,
    },
    applicant: {
      name: nameInput.value.trim(),
      // 伺服器端也是比對 /^09\d{8}$/，所以這裡要送和前端驗證同一份正規化結果，
      // 否則畫面放行、伺服器回 400。
      phone: phoneInput.value.replace(/\D/g, ''),
      email: emailInput.value.trim(),
      nationalId: idInput.value.trim().toUpperCase(),
      residence: {
        city: input.householdCity,
        district: input.district,
        detail: residenceDetail.value.trim(),
      },
      mailingSameAsResidence: mailingSame.checked,
      mailing: mailingSame.checked
        ? undefined
        : {
            city: mailingCity.value.trim(),
            district: mailingDistrict.value.trim(),
            detail: mailingDetail.value.trim(),
          },
      bank: { code: bank.code, account: bank.account, holderIsSelf: bankSelf.checked },
    },
    subsidy: {
      qualification: currentQualification(),
      tool: toolInput.value.trim(),
      amount: Number(amountInput.value),
    },
  };
}

/**
 * 送出申請。
 *
 * 失敗就停在確認頁並說明原因——這裡刻意沒有離線假編號。
 * 發一組本機產生的編號會讓流程看起來走完了，但承辦端沒收到，
 * 申請人拿那組編號去 LINE 也查不到，那比停在錯誤訊息上更糟。
 */
async function submitApplication() {
  const base = readApiBase();
  submitError.hidden = true;

  if (!base) {
    submitErrorText.textContent =
      '尚未設定收件伺服器位址，無法送出。請點右上角「連線設定」填入承辦端提供的網址。';
    submitError.hidden = false;
    return;
  }

  state.submitting = true;
  updateFooter();

  try {
    const response = await fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { ...NGROK_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // 伺服器的資格檢核回的是整份 failures，一次全部列出來比只講第一條有用。
      const detail = Array.isArray(data.failures) && data.failures.length > 1
        ? data.failures.map((f) => f.message).join(' ')
        : data.error;
      throw new Error(detail || `伺服器回應 ${response.status}`);
    }

    renderReceipt(data);
    goToStep(7);
    clearDraft();
    showToast('已完成收件');
  } catch (error) {
    submitErrorText.textContent = `${error.message}　請確認內容或連線後再試一次。`;
    submitError.hidden = false;
    submitError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    state.submitting = false;
    updateFooter();
  }
}

function renderReceipt(data) {
  receiptProgram.textContent = state.meta.program.name;
  caseNumber.textContent = data.caseCode;
  receivedAt.textContent = formatDateTime(data.receivedAt);
  receiptStatus.textContent = `${data.status}（已收件，尚未完成形式審查）`;
  reviewDue.textContent = `${data.reviewDueDate}（預計）`;
  receiptTool.textContent = `${toolInput.value.trim()}｜${formatMoney(Number(amountInput.value) || 0)}`;
  receiptGrant.textContent =
    `${formatMoney(data.grant.approved)}（${data.grant.label}，${Math.round(data.grant.rate * 100)}%，上限 ${formatMoney(data.grant.cap)}）`;

  const ready = data.documents.filter((d) => d.isReady);
  receiptDocs.textContent = ready.length
    ? ready.map((d) => `${d.docType}（${d.fileName}）`).join('、')
    : '無';
  receiptMissing.textContent = data.missingDocuments.length
    ? `${data.missingDocuments.join('、')}　將另行通知限期補正`
    : '無';
  receiptContact.textContent = `${data.contact.unit}　${data.contact.phone}`;
}

/* ---------------------------------------------------------------------------
 * 草稿暫存
 *
 * 只存不敏感的欄位。身分證字號與銀行帳號刻意不存——localStorage 是同網域的
 * 任何一支腳本都讀得到的地方，不是放證件號碼的位置。使用者回來時要重打，
 * 這個不方便是刻意換來的。
 * ------------------------------------------------------------------------- */

function saveDraft() {
  const draft = {
    step: state.currentStep === STEP_COUNT ? 1 : state.currentStep,
    consentPrivacy: consentPrivacy.checked,
    consentTerms: consentTerms.checked,
    birthDate: birthInput.value,
    city: cityInput.value,
    district: districtInput.value,
    noDuplicate: noDuplicate.checked,
    watchedSeconds: state.watchedSeconds,
    securityChecks: securityChecks.map((c) => c.checked),
    name: nameInput.value,
    phone: phoneInput.value,
    email: emailInput.value,
    residenceDetail: residenceDetail.value,
    mailingSame: mailingSame.checked,
    mailingCity: mailingCity.value,
    mailingDistrict: mailingDistrict.value,
    mailingDetail: mailingDetail.value,
    bankSelf: bankSelf.checked,
    qualification: currentQualification(),
    tool: toolInput.value,
    amount: amountInput.value,
    draftId: state.draftId,
    files: state.files,
    savedAt: Date.now(),
  };

  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {}
}

function clearDraft() {
  state.draftId = '';
  state.files = {};
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {}
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null');
  } catch {}
  if (!draft) return;

  // 上傳草稿在伺服器上只活 6 小時，過期後檔案已經被掃掉了。
  // 超過就不要把檔案清單還原出來，免得畫面說有、送出時卻缺件。
  const expired = Date.now() - (draft.savedAt ?? 0) > 6 * 60 * 60 * 1000;

  consentPrivacy.checked = Boolean(draft.consentPrivacy);
  consentTerms.checked = Boolean(draft.consentTerms);
  birthInput.value = draft.birthDate ?? '';
  cityInput.value = draft.city ?? '';
  noDuplicate.checked = Boolean(draft.noDuplicate);
  renderDistricts();
  districtInput.value = draft.district ?? '';

  state.watchedSeconds = Number(draft.watchedSeconds) || 0;
  securityChecks.forEach((check, i) => {
    check.checked = Boolean(draft.securityChecks?.[i]);
  });

  nameInput.value = draft.name ?? '';
  phoneInput.value = draft.phone ?? '';
  emailInput.value = draft.email ?? '';
  residenceDetail.value = draft.residenceDetail ?? '';
  mailingSame.checked = draft.mailingSame !== false;
  mailingCity.value = draft.mailingCity ?? '';
  mailingDistrict.value = draft.mailingDistrict ?? '';
  mailingDetail.value = draft.mailingDetail ?? '';
  bankSelf.checked = Boolean(draft.bankSelf);

  const radio = qualificationRadios.find((r) => r.value === draft.qualification);
  if (radio) radio.checked = true;
  toolInput.value = draft.tool ?? '';
  amountInput.value = draft.amount ?? '';

  if (!expired) {
    state.draftId = draft.draftId ?? '';
    state.files = draft.files ?? {};
  }

  renderWatchProgress();
  if (draft.step > 1) showToast('已還原上次填寫的內容');
}

/* ---------------------------------------------------------------------------
 * 從畫面現況回推狀態
 *
 * 重新整理時瀏覽器會自動還原勾選框與輸入框的內容，但**不會**派發 change／input
 * 事件。securityComplete 是快取的布林值、只在 change 時更新，所以會出現「三個框
 * 都是綠的，卻說尚未完成、按鈕還是反灰」——綠色是 CSS 的 :checked 畫的，跟那個
 * 布林值是兩回事。
 *
 * 結論是初始狀態不能用猜的，一律從 DOM 重新讀一次。
 * ------------------------------------------------------------------------- */

function syncFromDom() {
  state.securityComplete = securityChecks.every((item) => item.checked);
  securityResult.classList.toggle('complete', state.securityComplete);
  securityResult.querySelector('strong').textContent = state.securityComplete ? '✓ 已完成' : '尚未完成';

  qualificationCards.forEach((card) => {
    card.classList.toggle('active', card.querySelector('input').checked);
  });

  mailingFields.hidden = mailingSame.checked;
  districtRow.hidden = cityInput.value !== '新竹市';

  renderAgeHint();
  renderIdHint();
  renderBankHint();
  renderEligibility();
  calculateEstimate();
  updateFooter();
}

function renderDistricts() {
  const current = districtInput.value;
  districtInput.innerHTML =
    '<option value="">請選擇</option>' +
    HSINCHU_DISTRICTS.map((d) => `<option value="${d}">${d}</option>`).join('');
  districtInput.value = current;
}

function renderAgeHint() {
  const p = state.meta.program;
  if (!isRealDate(birthInput.value)) {
    ageHint.textContent = `以申請當日足歲計算，補助對象為 ${p.ageMin} 至 ${p.ageMax} 歲。`;
    ageHint.classList.remove('bad');
    return;
  }

  const age = ageOn(birthInput.value, today());
  const ok = age >= p.ageMin && age <= p.ageMax;
  ageHint.textContent = `申請當日為 ${age} 歲${ok ? '，符合年齡條件。' : `，不在 ${p.ageMin}–${p.ageMax} 歲範圍內。`}`;
  ageHint.classList.toggle('bad', !ok);
}

function renderIdHint() {
  const value = idInput.value.trim();
  if (!value) {
    idHint.textContent = '會即時檢查檢查碼，不會被保存。';
    idHint.classList.remove('bad', 'good');
    return;
  }

  const result = validateNationalId(value);
  idHint.textContent = result.ok ? `檢查碼正確，將以 ${result.masked} 保存。` : result.error;
  idHint.classList.toggle('bad', !result.ok);
  idHint.classList.toggle('good', result.ok);
}

function renderBankHint() {
  const value = bankAccount.value.trim();
  if (!value) {
    bankHint.textContent = '不會被保存，只留末四碼供承辦核對。';
    bankHint.classList.remove('bad', 'good');
    return;
  }

  const result = validateBankAccount(bankCode.value, value);
  bankHint.textContent = result.ok ? `將以 ${result.masked} 保存。` : result.error;
  bankHint.classList.toggle('bad', !result.ok);
  bankHint.classList.toggle('good', result.ok);
}

function renderEligibility() {
  const result = checkEligibility();
  const untouched = !birthInput.value && !cityInput.value;

  eligibilityResult.classList.toggle('complete', result.ok);
  eligibilityResult.classList.toggle('bad', !result.ok && !untouched);

  if (untouched) {
    eligibilityHeadline.textContent = '請先完成上方欄位';
    eligibilityFailures.innerHTML = '';
    return;
  }

  eligibilityHeadline.textContent = result.ok ? '✓ 符合申請資格' : '尚不符合申請資格';
  eligibilityFailures.innerHTML = result.failures
    .map((f) => `<li>${escapeHtml(f.message)}</li>`)
    .join('');
}

/* ---------------------------------------------------------------------------
 * 資安宣導
 * ------------------------------------------------------------------------- */

function renderWatchProgress() {
  const seconds = Math.min(REQUIRED_WATCH_SECONDS, Math.floor(state.watchedSeconds));
  const pct = Math.min(100, (seconds / REQUIRED_WATCH_SECONDS) * 100);

  watchTimer.textContent = `${String(seconds).padStart(2, '0')} / ${REQUIRED_WATCH_SECONDS} 秒`;
  watchProgress.style.width = `${pct}%`;

  if (seconds >= REQUIRED_WATCH_SECONDS) {
    state.watchComplete = true;
    watchLabel.textContent = '✓ 已完成觀看';
    watchLabel.classList.add('done');
    updateFooter();
  }
}

/* ---------------------------------------------------------------------------
 * 事件
 * ------------------------------------------------------------------------- */

// 網址上帶了 ?api= 就當場存起來，並把它從網址列拿掉——
// 留著的話使用者一按重新整理就會又送一次同樣的值，也容易被誤複製分享。
const apiFromUrl = new URLSearchParams(location.search).get('api');
if (apiFromUrl !== null) {
  saveApiBase(apiFromUrl);
  history.replaceState(null, '', location.pathname + location.hash);
}

apiConfigBtn.addEventListener('click', () => {
  const input = prompt(
    '收件伺服器位址（例：https://xxxx.ngrok-free.app）。\n留空則改用離線展示模式。',
    readApiBase(),
  );
  if (input === null) return;

  const saved = saveApiBase(input);
  showToast(saved ? '已設定收件伺服器' : '已切回離線展示模式');
  // 換了伺服器就要重新拿計畫資訊，而且舊的上傳草稿在新伺服器上不存在。
  state.draftId = '';
  state.files = {};
  loadProgram();
});

[consentPrivacy, consentTerms, noDuplicate, bankSelf, finalConfirm].forEach((box) => {
  box.addEventListener('change', () => {
    syncFromDom();
    saveDraft();
  });
});

birthInput.addEventListener('change', () => {
  syncFromDom();
  saveDraft();
});

cityInput.addEventListener('change', () => {
  if (cityInput.value !== '新竹市') districtInput.value = '';
  syncFromDom();
  saveDraft();
});

districtInput.addEventListener('change', () => {
  syncFromDom();
  saveDraft();
});

securityChecks.forEach((check) => {
  check.addEventListener('change', () => {
    syncFromDom();
    saveDraft();
  });
});

qualificationRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    // 身分別會改變應備文件清單（低收證明），所以清單要跟著重畫。
    syncFromDom();
    renderUploadList();
    saveDraft();
  });
});

mailingSame.addEventListener('change', () => {
  syncFromDom();
  saveDraft();
});

[nameInput, idInput, phoneInput, emailInput, residenceDetail, mailingCity, mailingDistrict,
  mailingDetail, bankCode, bankAccount, toolInput, amountInput].forEach((input) => {
  input.addEventListener('input', () => {
    syncFromDom();
    saveDraft();
  });
});

video.addEventListener('loadedmetadata', () => {
  videoPlaceholder.style.display = 'none';
});

video.addEventListener('error', () => {
  videoPlaceholder.style.display = 'grid';
});

video.addEventListener('timeupdate', () => {
  if (!state.watchComplete) {
    state.watchedSeconds = Math.max(state.watchedSeconds, video.currentTime);
    renderWatchProgress();
  }
});

video.addEventListener('ended', () => {
  if (!state.watchComplete && video.duration < REQUIRED_WATCH_SECONDS) {
    state.watchedSeconds = REQUIRED_WATCH_SECONDS;
    renderWatchProgress();
  }
});

demoPlayBtn.addEventListener('click', () => {
  if (state.demoTimer) return;
  demoPlayBtn.disabled = true;
  demoPlayBtn.textContent = 'Demo 播放中…';
  watchLabel.textContent = '正在觀看資安宣導';

  state.demoTimer = setInterval(() => {
    state.watchedSeconds += 1;
    renderWatchProgress();

    if (state.watchedSeconds >= REQUIRED_WATCH_SECONDS) {
      clearInterval(state.demoTimer);
      state.demoTimer = null;
      demoPlayBtn.textContent = '✓ Demo 宣導已完成';
      saveDraft();
      showToast('已完成 20 秒資安宣導');
    }
  }, 1000);
});

backBtn.addEventListener('click', () => {
  if (state.currentStep > 1) goToStep(state.currentStep - 1);
});

nextBtn.addEventListener('click', () => {
  if (state.submitting) return;

  const gate = gateFor(state.currentStep);
  if (!gate.ok) {
    showToast(gate.hint);
    return;
  }

  if (state.currentStep === 6) {
    submitApplication();
    return;
  }

  goToStep(state.currentStep + 1);
});

copyCaseBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(caseNumber.textContent);
    showToast('案件編號已複製');
  } catch {
    showToast(caseNumber.textContent);
  }
});

printBtn.addEventListener('click', () => window.print());

restartBtn.addEventListener('click', () => {
  clearDraft();

  [consentPrivacy, consentTerms, noDuplicate, bankSelf, mailingSame, finalConfirm].forEach((box) => {
    box.checked = box === mailingSame;
  });
  securityChecks.forEach((c) => { c.checked = false; });

  [birthInput, nameInput, idInput, phoneInput, emailInput, residenceDetail, mailingCity,
    mailingDistrict, mailingDetail, bankCode, bankAccount, toolInput, amountInput].forEach((input) => {
    input.value = '';
  });
  cityInput.value = '';
  districtInput.value = '';

  qualificationRadios[0].checked = true;

  state.watchedSeconds = 0;
  state.watchComplete = false;
  state.securityComplete = false;
  if (state.demoTimer) clearInterval(state.demoTimer);
  state.demoTimer = null;
  demoPlayBtn.disabled = false;
  demoPlayBtn.textContent = '沒有影片？使用 20 秒 Demo 計時';

  watchLabel.textContent = '尚未完成觀看';
  watchLabel.classList.remove('done');
  watchTimer.textContent = `00 / ${REQUIRED_WATCH_SECONDS} 秒`;
  watchProgress.style.width = '0%';
  submitError.hidden = true;

  try { video.currentTime = 0; } catch {}

  syncFromDom();
  goToStep(1);
});

/* ---------------------------------------------------------------------------
 * 啟動
 * ------------------------------------------------------------------------- */

renderApiStatus();
renderDistricts();
renderProgram();
restoreDraft();
renderUploadList();
syncFromDom();
updateStepper();
loadProgram();

// 表單還原有時候發生在這支腳本跑完之後，所以 pageshow 要再同步一次。
// 它在一般載入與上一頁返回（bfcache）都會觸發，兩種情況一起收掉。
window.addEventListener('pageshow', syncFromDom);
