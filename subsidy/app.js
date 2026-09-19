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
    { docType: '身分證正面', label: '國民身分證正面', note: '有照片、姓名與統一編號的那一面。', required: true },
    { docType: '身分證反面', label: '國民身分證反面', note: '有父母姓名、役別與住址的那一面。', required: true },
    { docType: '購買證明', label: '購買證明', note: '統一發票、收據，或線上訂閱的付款收據截圖都可以；需看得到品項、金額與日期。', required: true },
    { docType: '帳戶資料', label: '存摺封面影本', note: '戶名須為申請人本人，需可辨識金融機構代號與帳號。', required: true },
    { docType: '低收入戶證明', label: '低收入戶或中低收入戶證明', note: '僅申請 90% 補助者需檢附，有效期間需涵蓋申請日。', required: false, onlyFor: 'lowincome' },
  ],
  upload: {
    maxFileBytes: 5 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'],
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
  /**
   * 品質預檢沒過、正在等使用者決定的檔案，key 是 docType。
   *
   * 裡面有 File 物件，所以刻意不進 saveDraft()——草稿是 JSON，塞不下檔案，
   * 而且使用者關掉頁面後本來就該重選一次檔，不該默默留著一張被質疑過的照片。
   */
  quality: {},
  /**
   * 伺服器讀過內容後退回的檔案，key 是 docType，值多帶一個 file 供重送。
   *
   * 和 quality 的差別只在誰判的（瀏覽器看畫質、伺服器看文字），退回的方式一樣：
   * 檔案沒有被收下，這一格還是空的，使用者要嘛換一張，要嘛按「仍要使用這張」
   * 帶 override 重送。同樣有 File 物件，所以一樣不進 saveDraft()。
   */
  review: {},
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
const videoFreeze = $('videoFreeze');
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
 * 這一頁有三種跑法，優先序由高到低：
 *
 * 1. 手動設定——使用者在「連線設定」裡打過的位址，或網址帶了 ?api=。存在 localStorage。
 *    這一項永遠最優先：人明確講過的話，不該被任何自動偵測蓋掉。
 * 2. 同源——承辦端的 Express 自己把這一頁掛在 /subsidy。頁面和 API 同一個網域同一個埠，
 *    什麼都不必設定，開 http://localhost:3000/subsidy/ 就通。開機時探測一次就知道。
 * 3. 預設位址（DEFAULT_API_BASE）——GitHub Pages 上的退路。靜態頁在 github.io，
 *    收件的 Express 跑在承辦端電腦上、透過 ngrok 對外，兩者不同源，探測探不到。
 *    以前這種情況只能停在離線模式、等使用者自己去設定，現在直接連預設位址。
 *
 * 為什麼現在敢寫一個預設值：ngrok 免費帳號可以領一個**固定不變**的網址
 * （`ngrok http --url=<固定網址> 3000`）。舊的隨機網址每次重開都變，寫死只會過期得更難查；
 * 固定網址就沒有這個問題。要換後端位址時只改下面那一行，不必動其他地方。
 * ------------------------------------------------------------------------- */

const API_STORAGE_KEY = 'hc-ai-pass.apiBase';
const DRAFT_STORAGE_KEY = 'hc-ai-pass.subsidyDraft';

/**
 * Demo 模式：每次載入都從空白開始。
 *
 * 展示時同一台機器會連續跑好幾輪，草稿還原會讓第二輪一進去就看到上一輪的姓名、
 * 電話與已經跑滿的影片進度條，看起來像是流程被跳過了。所以這個旗標打開時：
 *
 * 1. `saveDraft()` 不寫 localStorage、`restoreDraft()` 改成把舊草稿清掉；
 * 2. 載入與 bfcache 返回都會跑一次 `resetForm()`，把欄位、觀看秒數與進度條歸零。
 *
 * 第 2 點不能省。第 1 點只擋得住我們自己存的草稿，瀏覽器重新整理時**自己**也會
 * 還原輸入框與勾選框的內容（HTML 規格的 form restoration），那一份不歸我們管，
 * 只能在它還原完之後自己再清一次——所以 `pageshow` 那一段也要清。
 *
 * 要回到「使用者中途離開還能接著填」的正式行為，把這行改成 false 就好，
 * 底下 saveDraft／restoreDraft 的原始邏輯都原封不動留著。
 */
const DEMO_ALWAYS_FRESH = true;

/**
 * 找不到同源 API 時要連的位址。留空字串就是關掉這個行為、回到舊的「停在離線模式」。
 *
 * 這必須是 ngrok 的**固定**網址，不是每次重開都變的那種隨機字串。
 * 後端的 ALLOWED_ORIGINS 也要含 github.io，否則瀏覽器會擋在 CORS。
 */
const DEFAULT_API_BASE = 'https://swipe-establish-earthling.ngrok-free.dev';

/** localStorage 裡代表「使用者明確要離線展示」的哨兵值。見 saveApiBase()。 */
const OFFLINE_SENTINEL = 'offline';

/** ngrok 免費版預設會先回一頁 HTML 攔截頁（ERR_NGROK_6024），這個標頭是官方指定的跳過方式。 */
const NGROK_HEADER = { 'ngrok-skip-browser-warning': '1' };

/** 同源探測的結果。探到才填，所以 GitHub Pages 上永遠是空字串。 */
let sameOriginBase = '';

/**
 * 同源探測跑完了沒。
 *
 * 在探完之前不要讓 DEFAULT_API_BASE 生效：不然本機開 localhost:3000/subsidy/ 時，
 * 狀態列會先閃一下遠端的 ngrok 位址再跳回 localhost，看起來像連錯地方。
 */
let sameOriginChecked = false;

function normalizeApiBase(value) {
  const base = String(value ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/.test(base) ? base : '';
}

function readStoredValue() {
  try {
    return String(localStorage.getItem(API_STORAGE_KEY) ?? '').trim();
  } catch {
    // 無痕模式可能讀不到 localStorage。這時只是當作沒設定過，不該讓整頁壞掉。
    return '';
  }
}

/** 使用者是不是明確選了離線展示模式。 */
function isExplicitlyOffline() {
  return readStoredValue() === OFFLINE_SENTINEL;
}

function readStoredApiBase() {
  return normalizeApiBase(readStoredValue());
}

/** 丟掉存起來的位址，讓解析退回同源探測或 DEFAULT_API_BASE。見 loadProgram() 的退場邏輯。 */
function clearStoredApiBase() {
  try { localStorage.removeItem(API_STORAGE_KEY); } catch {}
}

function readApiBase() {
  if (isExplicitlyOffline()) return '';

  const stored = readStoredApiBase();
  if (stored) return stored;
  if (sameOriginBase) return sameOriginBase;

  return sameOriginChecked ? DEFAULT_API_BASE : '';
}

/**
 * 保存「連線設定」的結果。
 *
 * 留白的語意是「我要離線展示」，而不是「清掉設定回到自動」——所以存一個哨兵值，
 * 不是把 key 刪掉。刪掉的話下次載入就會落回 DEFAULT_API_BASE 自動連上，
 * 使用者會覺得設定沒生效。想回到自動的人在同一個對話框輸入 auto。
 */
function saveApiBase(value) {
  const raw = String(value ?? '').trim();

  if (raw.toLowerCase() === 'auto') {
    try { localStorage.removeItem(API_STORAGE_KEY); } catch {}
    renderApiStatus();
    return readApiBase();
  }

  const base = normalizeApiBase(raw);
  try {
    if (base) localStorage.setItem(API_STORAGE_KEY, base);
    else localStorage.setItem(API_STORAGE_KEY, OFFLINE_SENTINEL);
  } catch {}
  // 選了離線就連同源探測結果也要一起清掉，否則畫面會立刻又跳回「已連線」。
  if (!base) sameOriginBase = '';
  renderApiStatus();
  return base;
}

/**
 * 探測這一頁是不是由收件伺服器自己 serve 出來的。
 *
 * 只打一支唯讀的 GET，失敗就當作不是同源、安靜地往下一層退——
 * GitHub Pages 上這支會回 404 的 HTML，`response.json()` 會丟例外，正好被 catch 吃掉。
 *
 * 不論走哪條路徑都要把 sameOriginChecked 設起來（所以用 finally），
 * 否則 DEFAULT_API_BASE 永遠不會生效。
 */
async function detectSameOriginApi() {
  try {
    if (readStoredValue()) return; // 已經明確設定過（含離線）就不要自作聰明
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    // 一定要帶 NGROK_HEADER：頁面若是由 ngrok 通道上的 /subsidy/ 提供，
    // 沒帶這個標頭的話 ngrok 免費版會回它自己的警告頁 HTML 而不是我們的 JSON，
    // response.ok 會是 true、response.json() 會丟例外，最後被 catch 吃掉，
    // 於是明明就是同源卻被判成「離線展示模式」。同源請求不會因此觸發 preflight。
    const response = await fetch(`${location.origin}/api/applications/program`, { headers: NGROK_HEADER });
    if (!response.ok) return;

    const data = await response.json();
    if (!data?.program) return;

    sameOriginBase = location.origin;
  } catch {
    // 不是同源。這是預期中的結果，不用吵使用者。
  } finally {
    sameOriginChecked = true;
    renderApiStatus();
  }
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

/**
 * 已經因為連不上而退回 DEFAULT_API_BASE 了沒。用來擋住無限重試——
 * 退回之後若連預設位址也不通，就老實顯示離線，不要再繞回來。
 */
let fellBackToDefault = false;

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
    // 連上了就把旗標放掉，之後換伺服器還能再退一次。
    fellBackToDefault = false;
  } catch (error) {
    // 存在 localStorage 的位址過期，是這個 demo 最常見的狀況：ngrok 的隨機網址一重開
    // 就死，但設定還留在瀏覽器裡，而且它的優先序最高，會一路蓋掉固定網址——狀態列
    // 還會顯示「已連線：<那個死掉的網址>」。所以這裡不能只是退回離線資料，要把過期
    // 的設定清掉、改用預設位址再試一次。使用者真的想指定別台，重設一次即可。
    const stored = readStoredApiBase();
    if (!fellBackToDefault && DEFAULT_API_BASE && stored && stored === base) {
      fellBackToDefault = true;
      clearStoredApiBase();
      renderApiStatus();
      showToast('原本設定的伺服器連不上，已改用預設位址');
      return loadProgram();
    }

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
        <span class="doc-tag">${doc.required ? '必附' : `${escapeHtml(p.grants[doc.onlyFor]?.label ?? '特定身分')}必附`}</span>
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
    // 2026-09-19 起缺件就擋。原本是「先收件、缺的走補正」，現在照使用者要求改成
    // 全部必附——所以下面的 ok 直接看 missing.length，沒有例外。
    //
    // 注意 requiredDocuments() 已經把低收證明過濾掉了（只有申請 90% 的人看得到），
    // 所以這裡是「畫面上看得到的每一格都要有檔案」，不是「五格都要有」。
    const missing = requiredDocuments().filter((doc) => !state.files[doc.docType]);
    return {
      ok: missing.length === 0,
      cta: '確認申請內容',
      hint: missing.length === 0
        ? '應備文件已檢附齊全'
        : `尚未上傳：${missing.map((doc) => doc.label).join('、')}`,
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

  // 要排在 updatePanels() 之後：那一行才會把 panel-3 從 display:none 放出來，
  // 而瀏覽器不會替尺寸是 0 的 <video> 載東西。見 kickVideoIfIdle()。
  if (state.currentStep === 3) kickVideoIfIdle();
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
const ASCII = (text) => [...text].map((c) => c.charCodeAt(0));

const SIGNATURES = [
  { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // iPhone 拍的就是這個。檔頭從第 4 個位元組開始，'ftyp' 後面那 4 碼是品牌碼。
  // 伺服器收到之後會轉成 JPEG，這裡只負責認出來、別擋下來。
  ...['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].map((brand) => ({
    mimeType: 'image/heic',
    offset: 4,
    magic: [...ASCII('ftyp'), ...ASCII(brand)],
  })),
];

function sniffType(bytes) {
  if (!bytes || bytes.length < 8) return null;
  return (
    SIGNATURES.find((sig) =>
      sig.magic.every((byte, i) => bytes[(sig.offset ?? 0) + i] === byte),
    ) ?? null
  );
}

function renderUploadList() {
  const docs = requiredDocuments();

  uploadList.innerHTML = docs
    .map((doc) => {
      const file = state.files[doc.docType];
      const done = Boolean(file);
      const flagged = state.quality[doc.docType];
      const review = state.review[doc.docType];
      return `
        <div class="upload-item ${done ? 'ok' : ''} ${flagged || review ? 'flagged' : ''}" data-doc="${escapeHtml(doc.docType)}">
          <div class="upload-copy">
            <strong>${escapeHtml(doc.label)}</strong>
            <span class="doc-tag">${doc.required ? '必附' : '必附（低收／中低收）'}</span>
            <small>${escapeHtml(doc.note)}</small>
            ${done
              ? `<div class="upload-file">📄 ${escapeHtml(file.displayName)}　${formatBytes(file.size)}</div>`
              : ''}
            ${flagged
              ? `<div class="upload-warning">
                   <strong>⚠️ ${escapeHtml(flagged.verdict.message)}</strong>
                   <small>${escapeHtml(flagged.verdict.hint)}</small>
                   <small class="upload-warning-file">這個檔案沒有被收下：${escapeHtml(flagged.file.name)}　${formatBytes(flagged.file.size)}</small>
                   <small class="upload-warning-block">請重新選擇一張照片，這一格才會完成。</small>
                 </div>`
              : ''}
            ${review
              ? `<div class="upload-warning">
                   <strong>⚠️ ${escapeHtml(review.message)}</strong>
                   <small>${escapeHtml(review.hint)}</small>
                   <small class="upload-warning-file">這個檔案沒有被收下：${escapeHtml(review.file.name)}　${formatBytes(review.file.size)}</small>
                   <small class="upload-warning-block">請重新選擇一張照片，這一格才會完成。</small>
                 </div>`
              : ''}
            <div class="upload-error" hidden></div>
          </div>
          <div class="upload-actions">
            <label class="ghost-btn upload-pick">
              ${flagged || review ? '重新選擇' : done ? '重新上傳' : '選擇檔案'}
              <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf" hidden>
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
    // 「這張沒問題，仍要上傳」與「我確認沒傳錯，仍要使用這張」兩個出口已移除，
    // 改成沒通過就是不收（見 uploadDocument() 開頭的說明）。唯一的路是重新選一張。
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

/**
 * 使用者選了一個檔案。先擋掉一定不會成功的，再做品質預檢，最後才送出。
 *
 * 品質預檢只回答「這張圖能不能看」（太小、全黑、糊掉），回答不了
 * 「這是不是正確的文件」——那要文字辨識才知道。
 *
 * **2026-09-19 改為沒通過就不收。** 原本這一層與伺服器端的 OCR 都只是提示，
 * 各留一個「我就是要傳」的按鈕；現在兩個出口都拿掉了，判定不通過就亮橘燈、
 * 檔案不上傳，使用者只能重新選一張。
 *
 * 要注意這不等於把判讀變嚴：`image-check.js` 的 fail-open 前提沒有動，
 * 解碼失敗、瀏覽器不支援、PDF 一律回 `ok:true`，所以真正被擋下來的只有
 * 「量得出來而且量出問題」的那些。這一點不能改——判讀不出來就放行，
 * 否則舊手機上會變成整份申請都送不出去。
 */
async function uploadDocument(docType, file, item) {
  showUploadError(item, '');
  delete state.quality[docType];
  delete state.review[docType];

  const base = readApiBase();
  if (!base) {
    showUploadError(item, '尚未連線到收件伺服器，無法上傳。所有文件都必須上傳才能送出，請先確認連線。');
    return;
  }

  const maxBytes = state.meta.upload.maxFileBytes;
  if (file.size > maxBytes) {
    showUploadError(item, `單一檔案不得超過 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
    return;
  }

  const verdict = await UploadImageCheck.inspect(file);
  if (!verdict.ok) {
    state.quality[docType] = { file, verdict };
    renderUploadList();
    return;
  }

  sendDocument(docType, file, item);
}

/**
 * 上傳前先在瀏覽器裡把照片縮小、重新編成 JPEG。
 *
 * 為什麼要有這一層：實測 ngrok 免費通道的上行是瓶頸，不是伺服器。拿一支
 * 一定回 404 的端點（伺服器不落地、不做辨識）連續送四次 700KB，量到
 * 5.3s／15.8s／17.8s／24.0s，最後一次直接被通道回 503——瀏覽器把傳到一半
 * 斷掉的請求就顯示成「Failed to fetch」。同一時間伺服器端的 HEIC 轉檔加
 * 文字辨識只要 0.14–0.5 秒。也就是說，唯一有效的手段是少傳一點位元組。
 *
 * 為什麼縮到 1800px 還夠用：身分證的欄位名在 1800px 長邊下大約等於 500 DPI
 * 以上，Tesseract 要的是 300 DPI。縮太多才會傷辨識，縮到這裡不會。
 *
 * 整段是 fail-open 的：解不開、畫不出來、或縮完反而更大，就照原檔送。
 * 這一點不能改——寧可慢，也不能因為縮圖失敗就讓人傳不了文件。
 */
const SHRINK_MAX_EDGE = 1800;
const SHRINK_QUALITY_STEPS = [0.75, 0.6];
const SHRINK_SKIP_BYTES = 320 * 1024; // 已經夠小就別動，重壓只會掉畫質

async function shrinkForUpload(file) {
  try {
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|heic|heif)$/i.test(file.name || '')) return file;
    if (file.size <= SHRINK_SKIP_BYTES) return file;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

    // imageOrientation: 'from-image' 讓瀏覽器自己套 EXIF 轉向，
    // 免得直的照片畫進 canvas 之後變成橫的、文字全部側著。
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, SHRINK_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === 'function') bitmap.close();

    let best = null;
    for (const quality of SHRINK_QUALITY_STEPS) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) break;
      best = blob;
      if (blob.size <= SHRINK_SKIP_BYTES) break;
    }
    // 縮完比原檔還大就不划算（小張 PNG 轉 JPEG 常常這樣），照原檔送。
    if (!best || best.size >= file.size) return file;
    return best;
  } catch {
    // 瀏覽器解不了這個格式（Chrome 桌面版就解不了 HEIC）。照原檔送。
    return file;
  }
}

async function sendDocument(docType, file, item, { override = false } = {}) {
  const base = readApiBase();
  if (!base || !item) return;

  showUploadError(item, '處理照片中…', true);
  const payload = await shrinkForUpload(file);
  const buffer = await payload.arrayBuffer();
  // 先在本機比對檔頭。送出去才被退回的話，使用者要等一趟網路來回才知道選錯檔。
  const sig = sniffType(new Uint8Array(buffer));
  if (!sig) {
    showUploadError(item, '只接受 JPG、PNG、HEIC 或 PDF 檔。認的是檔案內容，改副檔名沒有用。');
    return;
  }

  showUploadError(item, '上傳中…', true);

  try {
    const draftId = await ensureDraft(base);
    const query = `docType=${encodeURIComponent(docType)}&filename=${encodeURIComponent(file.name)}${override ? '&override=1' : ''}`;

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
    // 422：伺服器讀過內容，認定這張不是這一格要的東西，檔案沒有被收下。
    // 和其他錯誤分開處理，因為它要畫成橘色的 flagged 警告（含伺服器給的理由與建議），
    // 不是紅色的上傳失敗。伺服器仍然支援 `?override=1`，但前端已經沒有按鈕會帶它。
    if (response.status === 422 && data.review) {
      state.review[docType] = { ...data.review, file };
      renderUploadList();
      return;
    }
    if (!response.ok) throw new Error(data.error || `伺服器回應 ${response.status}`);

    state.files[docType] = data.file;
    delete state.review[docType];
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
  delete state.quality[docType];
  delete state.review[docType];
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
              <small>${file ? `${escapeHtml(file.displayName)}　${formatBytes(file.size)}` : '尚未上傳，請回上一步補齊'}</small>
            </div>
          </li>`;
        }).join('')}
      </ul>
      <p class="review-note">${missing.length === 0
        ? `已檢附 ${attached.length} 件，應備文件齊全。`
        : `已檢附 ${attached.length} 件，尚缺 ${missing.length} 件。所有文件都必須上傳才能送出。`}</p>
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
  let binding = document.getElementById('line-binding');
  if (!binding) {
    binding = document.createElement('div'); binding.id = 'line-binding';
    receiptContact.parentElement.after(binding);
  }
  binding.replaceChildren();
  if (data.lineBinding) {
    const open = document.createElement('a');
    open.className = 'line-bind-btn';

    if (data.lineBinding.liffId) {
      /*
       * LIFF 路徑：真正的一鍵綁定，桌機與手機都走得完。
       *
       * 手機上 liff.line.me 會直接叫起 LINE App 的內建瀏覽器，桌機則在瀏覽器裡跑一次
       * LINE Login。兩邊拿到的是同一組 userId，所以不必再請使用者傳訊息給官方帳號。
       *
       * api 參數要帶：LIFF 的 Endpoint URL 是寫死在 LINE 後台的，不保證和收件頁同源
       * （endpoint 設 GitHub Pages、後端在 ngrok 時就不同源）。帶著走，綁定頁才知道
       * 該打哪一台伺服器。
       */
      const url = new URL(`https://liff.line.me/${encodeURIComponent(data.lineBinding.liffId)}`);
      url.searchParams.set('token', data.lineBinding.code);
      const base = readApiBase();
      if (base) url.searchParams.set('api', base);

      /*
       * liffId 也一起帶過去。
       *
       * 它雖然就在上面那串網址的路徑裡，但 LINE 轉去 Endpoint URL 之後路徑會換成
       * 綁定頁自己的，liffId 就不見了——所以綁定頁本來得先打一次 /program 把它問回來。
       * 那一次請求跑在 ngrok 免費通道上，偏偏是整個流程最後、也最不能失敗的一步：
       * 通道一慢或一斷，畫面就停在「連不上收件伺服器」，綁定碼只顯示一次也補不回來。
       * 這裡多帶一個參數，就能讓 liff.init() 不必等那次往返。
       */
      url.searchParams.set('liff', data.lineBinding.liffId);
      open.href = url.toString();
      open.textContent = '用 LINE 一鍵綁定通知';
      open.setAttribute('aria-label', '用 LINE 一鍵綁定審核通知');
      binding.append(open);

      // 退路。現場 LIFF 若出狀況（設定跑掉、LINE 的 CDN 不通），還有舊的聊天室綁定可用。
      // 綁定碼只顯示這一次，錯過就得重送一份申請，所以這條路要留著。
      const fallback = document.createElement('a');
      fallback.className = 'line-bind-fallback';
      fallback.href = data.lineBinding.chatUrl;
      fallback.textContent = '一鍵綁定沒反應？改用聊天室綁定（限手機）';
      binding.append(fallback);
    } else {
      open.href = data.lineBinding.chatUrl;
      open.textContent = '用 LINE 一鍵綁定通知';
      open.setAttribute('aria-label', '用手機 LINE 開啟官方帳號並綁定審核通知');
      open.addEventListener('click', (event) => {
        // LINE 官方的 oaMessage 網址只保證支援 iOS／Android。桌機瀏覽器會導到官網，
        // 看起來像按鈕壞掉；直接留在原頁說明限制，避免遺失只能顯示一次的綁定碼。
        if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          event.preventDefault();
          showToast('LINE 一鍵綁定僅支援手機，請用手機開啟這個申請頁。');
        }
      });
      binding.append(open);
    }
  }
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
  // Demo 模式不留任何痕跡，見 DEMO_ALWAYS_FRESH。
  if (DEMO_ALWAYS_FRESH) return;

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
  // Demo 模式：不還原，順手把上一輪留下來的草稿刪掉。
  // 只 return 不刪的話，之後把 DEMO_ALWAYS_FRESH 關回 false 會突然冒出一份很舊的草稿。
  if (DEMO_ALWAYS_FRESH) {
    clearDraft();
    return;
  }

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
    '收件伺服器位址（例：https://xxxx.ngrok-free.app）。\n'
      + '留空＝離線展示模式；輸入 auto ＝ 回到自動連線。',
    readApiBase(),
  );
  if (input === null) return;

  const saved = saveApiBase(input);
  showToast(saved ? `已連線：${saved.replace(/^https?:\/\//, '')}` : '已切回離線展示模式');
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

/**
 * 影片沒動靜時踢它一腳。
 *
 * 這是「有時候影片就是不播」的真正原因，量出來的：分頁在背景時 Chrome 根本不會載
 * 媒體——請求送出去就停在 pending，`networkState` 是 2（LOADING）、`readyState` 停在 0、
 * **而且不會觸發 error**。同一支檔案用 fetch() 抓是 200、5.8MB、5 秒抓完，換成
 * <video> 就永遠卡住；從 localhost 抓也一樣，所以跟 ngrok、跟檔案大小都無關。
 *
 * 同一類的還有兩種：STEP 03 還沒打開時 <video> 在 display:none 的子樹裡（尺寸 0），
 * 以及使用者切到別的分頁再切回來。共通點都是「瀏覽器決定現在不載」，
 * 而它不會在條件恢復時自己重來。
 *
 * 所以在分頁變可見、以及走到 STEP 03 時各檢查一次：還停在 readyState 0 就重新 load()。
 */
function kickVideoIfIdle() {
  if (video.readyState !== 0) return;
  if (video.error) return; // 真的失敗了，交給 error 那條路處理，不要跟它打架
  try { video.load(); } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') kickVideoIfIdle();
});

/**
 * 影片載入失敗時重試一次再放棄。
 *
 * 現場 Wi-Fi 底下最常見的不是「檔案不見了」，是 MEDIA_ERR_NETWORK：連線中途斷掉，
 * 瀏覽器就把 <video> 判死、不會自己重來。以前這裡直接蓋上「載入失敗」的說明，
 * 於是一個純粹的暫時性斷線看起來像影片檔壞了。
 *
 * load() 之後要重設 src（同一串網址瀏覽器可能直接沿用失敗的快取項目），所以加一個
 * 一次性的參數把它打掉。只重試一次——真的是 404 的話重試幾次都一樣，
 * 讓 Demo 計時的退路早點出現比較有用。
 *
 * **連 code 4 也重試。** 原本這裡把 MEDIA_ERR_SRC_NOT_SUPPORTED 排除掉，理由寫的是
 * 「多半是真的沒這個檔」。實測推翻了這個假設：GitHub Pages 對這支 mp4 回過一次 503，
 * 而伺服器回非 2xx 時瀏覽器丟出來的就是 code 4——跟真的 404 長得一模一樣，分不出來。
 * 503 重試一次多半就過了，所以不再挑錯誤碼，一律給一次機會。
 */
let videoRetried = false;

video.addEventListener('error', () => {
  const code = video.error?.code ?? 0;

  if (!videoRetried) {
    videoRetried = true;
    const source = video.querySelector('source');
    if (source) {
      const url = new URL(source.getAttribute('src'), location.href);
      url.searchParams.set('retry', String(Date.now()));
      source.setAttribute('src', url.pathname + url.search);
      video.load();
      return;
    }
  }

  // 把實際的錯誤碼寫進說明裡。4 = 找不到／不支援，2 = 網路中斷，3 = 解碼失敗。
  // 現場要判斷「是檔案問題還是網路問題」就靠這個數字，不然只能猜。
  const reason = { 1: '載入被中止', 2: '網路中斷', 3: '影片解碼失敗', 4: '找不到影片檔或格式不支援' }[code] || '未知原因';
  const copy = videoPlaceholder.querySelector('.placeholder-copy');
  if (copy) copy.textContent = `影片載入失敗（${reason}）。可以先用下面的計時完成這一步。`;
  videoPlaceholder.style.display = 'grid';
});

video.addEventListener('timeupdate', () => {
  if (!state.watchComplete) {
    state.watchedSeconds = Math.max(state.watchedSeconds, video.currentTime);
    renderWatchProgress();
  }
});

/**
 * 播完之後把畫面凍在最後一幀。
 *
 * 為什麼不直接靠 <video> 自己：規格沒有規定播完要留在哪一幀，各家做法不一樣。
 * Chrome 多半會留住，iOS Safari 退出全螢幕後常常回到第一幀或直接變黑，
 * 而只要有任何一段程式碼碰到 `currentTime = 0`（例如「重新填寫」）就會跳回開頭。
 * 把那一幀畫進 canvas 蓋上去，就跟播放器的行為完全脫鉤了。
 *
 * 影片是同源檔案，canvas 不會被污染，`drawImage` 不會丟 SecurityError；
 * 真的失敗（例如編碼器還沒吐出畫面）就安靜放棄，不要讓宣導頁因此壞掉。
 */
function freezeLastFrame() {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;

  videoFreeze.width = width;
  videoFreeze.height = height;

  try {
    videoFreeze.getContext('2d').drawImage(video, 0, 0, width, height);
  } catch {
    return;
  }
  videoFreeze.hidden = false;
}

function clearFreezeFrame() {
  videoFreeze.hidden = true;
}

// 定格畫面蓋住了瀏覽器自己的控制列，所以它要自己收下點擊——按一下收起來，
// 控制列就回來了。不順手替使用者按播放：宣導影片重播與否由他決定。
videoFreeze.addEventListener('click', clearFreezeFrame);

// 使用者從控制列按播放（或拖動進度條）時，定格畫面要立刻讓開。
video.addEventListener('play', clearFreezeFrame);
video.addEventListener('seeking', clearFreezeFrame);

video.addEventListener('ended', () => {
  if (!state.watchComplete && video.duration < REQUIRED_WATCH_SECONDS) {
    state.watchedSeconds = REQUIRED_WATCH_SECONDS;
    renderWatchProgress();
  }
  freezeLastFrame();
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

/**
 * 把整份表單清回出廠狀態。
 *
 * 「重新填寫」按鈕與 demo 模式的每次載入共用這一份，兩邊不能各寫各的——
 * 漏掉任何一個欄位，症狀都是「畫面上是空的，按鈕卻說已完成」，非常難查。
 */
function resetForm() {
  clearDraft();

  [consentPrivacy, consentTerms, noDuplicate, bankSelf, mailingSame, finalConfirm].forEach((box) => {
    box.checked = box === mailingSame;
  });
  // 三題選擇題不用另外清：security-quiz.js 覆寫了 .security-check 的 checked setter，
  // 上面這一行會連帶把選項、對錯樣式與解說文字一起還原。直接去動 #securityQuiz 裡的
  // radio 反而會繞過它的 render()，留下上一輪的綠框。
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

  // 已上傳的檔案清單也要跟著歸零，否則 STEP 5 會顯示上一輪的檔名，
  // 而那份草稿在伺服器上已經被我們自己清掉了。
  state.files = {};
  state.quality = {};
  state.review = {};
  renderUploadList();

  clearFreezeFrame();
  // 重新整理時瀏覽器會把 <video> 停在上次的秒數，連原生進度條都是滿的。
  try { video.pause(); } catch {}
  try { video.currentTime = 0; } catch {}
}

restartBtn.addEventListener('click', () => {
  resetForm();
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
if (DEMO_ALWAYS_FRESH) resetForm();
renderUploadList();
syncFromDom();
updateStepper();

// 先探同源再拿計畫資訊：順序反過來的話，第一次載入會先用內建資料畫一次、
// 再跳一個「連不上收件伺服器」的 toast，而其實是連得上的。
detectSameOriginApi().then(loadProgram);

// 表單還原有時候發生在這支腳本跑完之後，所以 pageshow 要再同步一次。
// 它在一般載入與上一頁返回（bfcache）都會觸發，兩種情況一起收掉。
//
// demo 模式在這裡才是真正清乾淨的那一次：pageshow 排在 load 之後，
// 瀏覽器自己的 form restoration 與 security-quiz.js 的 setter 覆寫這時都已經做完了，
// 上面啟動段那次 resetForm() 清不掉的東西（被還原的 radio、影片秒數）在這裡會被清掉。
window.addEventListener('pageshow', () => {
  if (DEMO_ALWAYS_FRESH) {
    resetForm();
    goToStep(1);
  }
  syncFromDom();
});
