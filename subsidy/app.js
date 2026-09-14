const state = {
  currentStep: 1,
  watchedSeconds: 0,
  watchComplete: false,
  demoTimer: null,
  securityComplete: false
};

const REQUIRED_WATCH_SECONDS = 20;

const panels = [...document.querySelectorAll(".step-panel")];
const steps = [...document.querySelectorAll(".step")];
const stepLines = [...document.querySelectorAll(".step-line")];

const nextBtn = document.getElementById("nextBtn");
const nextBtnText = document.getElementById("nextBtnText");
const footerStatus = document.getElementById("footerStatus");

const video = document.getElementById("awarenessVideo");
const videoPlaceholder = document.getElementById("videoPlaceholder");
const demoPlayBtn = document.getElementById("demoPlayBtn");
const watchTimer = document.getElementById("watchTimer");
const watchProgress = document.getElementById("watchProgress");
const watchLabel = document.getElementById("watchLabel");

const securityChecks = [...document.querySelectorAll(".security-check")];
const securityResult = document.getElementById("securityResult");

const qualificationRadios = [...document.querySelectorAll('input[name="qualification"]')];
const qualificationCards = [...document.querySelectorAll(".qual-card")];
const amountInput = document.getElementById("amountInput");
const estimateRule = document.getElementById("estimateRule");
const estimateAmount = document.getElementById("estimateAmount");

const nameInput = document.getElementById("nameInput");
const phoneInput = document.getElementById("phoneInput");
const toolInput = document.getElementById("toolInput");

const apiDot = document.getElementById("apiDot");
const apiStatus = document.getElementById("apiStatus");
const apiConfigBtn = document.getElementById("apiConfigBtn");
const offlineNotice = document.getElementById("offlineNotice");

const caseNumber = document.getElementById("caseNumber");
const copyCaseBtn = document.getElementById("copyCaseBtn");
const restartBtn = document.getElementById("restartBtn");
const toast = document.getElementById("toast");

function formatMoney(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(value).replace("TWD", "NT$");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1600);
}

function renderWatchProgress() {
  const seconds = Math.min(REQUIRED_WATCH_SECONDS, Math.floor(state.watchedSeconds));
  const pct = Math.min(100, (seconds / REQUIRED_WATCH_SECONDS) * 100);

  watchTimer.textContent = `${String(seconds).padStart(2, "0")} / ${REQUIRED_WATCH_SECONDS} 秒`;
  watchProgress.style.width = `${pct}%`;

  if (seconds >= REQUIRED_WATCH_SECONDS) {
    state.watchComplete = true;
    watchLabel.textContent = "✓ 已完成觀看";
    watchLabel.style.color = "#06C755";
    updateFooter();
  }
}

function updateStepper() {
  steps.forEach((step, index) => {
    const num = index + 1;
    step.classList.toggle("active", num === state.currentStep);
    step.classList.toggle("done", num < state.currentStep);
    const dot = step.querySelector(".step-dot");
    dot.textContent = num < state.currentStep ? "✓" : num;
  });

  stepLines.forEach((line, index) => {
    line.classList.toggle("done", index + 1 < state.currentStep);
  });
}

function updatePanels() {
  panels.forEach((panel, index) => {
    panel.classList.toggle("active", index + 1 === state.currentStep);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validateApplication() {
  const phone = phoneInput.value.trim();
  return (
    nameInput.value.trim().length >= 2 &&
    /^09\d{8}$/.test(phone.replace(/\s/g, "")) &&
    toolInput.value.trim().length >= 2 &&
    Number(amountInput.value) > 0
  );
}

function updateFooter() {
  if (state.currentStep === 1) {
    nextBtn.disabled = !state.watchComplete;
    nextBtnText.textContent = state.watchComplete ? "開始 AI 安全檢核" : "繼續申請";
    footerStatus.textContent = state.watchComplete ? "已完成宣導，可以繼續" : "完成資安宣導後即可繼續";
  } else if (state.currentStep === 2) {
    nextBtn.disabled = !state.securityComplete;
    nextBtnText.textContent = "進入補助申請";
    footerStatus.textContent = state.securityComplete ? "AI 安全三問已完成" : "請完成三項資安檢核";
  } else if (state.currentStep === 3) {
    const valid = validateApplication();
    nextBtn.disabled = !valid;
    nextBtnText.textContent = "送出補助申請";
    footerStatus.textContent = valid ? "資料已完成，可送出申請" : "請完成姓名、電話、工具與金額";
  } else {
    nextBtn.style.display = "none";
    footerStatus.textContent = "申請已完成";
  }
}

function goToStep(step) {
  state.currentStep = step;
  nextBtn.style.display = step === 4 ? "none" : "flex";
  updateStepper();
  updatePanels();
  updateFooter();
}

/* ---------------------------------------------------------------------------
 * 收件伺服器
 *
 * 這一頁是 GitHub Pages 上的靜態頁，收件的 Express 跑在承辦端的電腦上、透過 ngrok
 * 對外。ngrok 每次重開網址都會變，所以位址不能寫死：用 ?api=https://xxx.ngrok-free.app
 * 帶進來，存進 localStorage，之後回訪就不必再帶一次。
 * ------------------------------------------------------------------------- */

const API_STORAGE_KEY = "hc-ai-pass.apiBase";

/** 去掉結尾斜線，並擋掉明顯不是 http(s) 的輸入。回傳 "" 代表沒有可用位址。 */
function normalizeApiBase(value) {
  const base = String(value ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/.+/.test(base) ? base : "";
}

function readApiBase() {
  try {
    return normalizeApiBase(localStorage.getItem(API_STORAGE_KEY));
  } catch {
    // 無痕模式可能讀不到 localStorage。這時只是回到離線模式，不該讓整頁壞掉。
    return "";
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
  apiDot.classList.toggle("online", Boolean(base));
  apiStatus.textContent = base ? `已連線：${base.replace(/^https?:\/\//, "")}` : "離線展示模式";
}

/**
 * 真的把申請送到承辦端。成功回案件編號（YOUTH-NNN），失敗丟例外。
 *
 * 編號由伺服器發，不是這裡算的——這樣申請人拿到的編號才查得到，
 * LINE Bot 的「查詢進度」用的就是同一組編號。
 */
async function submitToServer(base) {
  const response = await fetch(`${base}/api/applications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // ngrok 免費版預設會先回一頁 HTML 攔截頁，回應就不是 JSON 了（ERR_NGROK_6024）。
      // 這個標頭是官方指定的跳過方式。
      "ngrok-skip-browser-warning": "1",
    },
    body: JSON.stringify({
      name: nameInput.value.trim(),
      phone: phoneInput.value.replace(/\s/g, ""),
      qualification: document.querySelector('input[name="qualification"]:checked').value,
      tool: toolInput.value.trim(),
      amount: Number(amountInput.value),
      documents: [...document.querySelectorAll(".document-item")].map((item) => ({
        docType: item.querySelector("strong").textContent.trim(),
        isReady: item.dataset.state === "ok",
      })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `伺服器回應 ${response.status}`);
  return data.caseCode;
}

/** 離線時用的假編號。格式刻意和伺服器發的 YOUTH-NNN 不一樣，一眼就看得出沒送出去。 */
function generateCaseNumber() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `HC-AI-${y}${m}${d}-${rnd}`;
}

/**
 * 送出申請並切到完成頁。
 *
 * 這裡不會硬失敗：連不上收件伺服器就退回離線假編號，流程照樣走完，
 * 只是在完成頁掛一段警告說明沒有真的送出去。現場展示不能停在錯誤訊息上。
 */
async function finishSubmission() {
  const base = readApiBase();
  let caseCode = "";
  let reason = base ? "" : "尚未設定收件伺服器位址";

  if (base) {
    try {
      caseCode = await submitToServer(base);
    } catch (error) {
      reason = `連不上收件伺服器（${error.message}）`;
    }
  }

  const online = Boolean(caseCode);
  offlineNotice.hidden = online;
  if (!online) {
    caseCode = generateCaseNumber();
    offlineNotice.querySelector("p").textContent =
      `${reason}，以下是本機產生的展示編號，承辦端不會收到這筆申請。`;
  }

  caseNumber.textContent = caseCode;
  goToStep(4);
  showToast(online ? "申請已送出，承辦端已收件" : "已完成離線展示流程");
}

// 網址上帶了 ?api= 就當場存起來，並把它從網址列拿掉——
// 留著的話使用者一按重新整理就會又送一次同樣的值，也容易被誤複製分享。
const apiFromUrl = new URLSearchParams(location.search).get("api");
if (apiFromUrl !== null) {
  saveApiBase(apiFromUrl);
  history.replaceState(null, "", location.pathname + location.hash);
}

apiConfigBtn.addEventListener("click", () => {
  const input = prompt(
    "收件伺服器位址（例：https://xxxx.ngrok-free.app）。\n留空則改用離線展示模式。",
    readApiBase(),
  );
  if (input === null) return;

  const saved = saveApiBase(input);
  showToast(saved ? "已設定收件伺服器" : "已切回離線展示模式");
});

// Detect whether the mp4 exists.
// If not, show the built-in placeholder and demo timer.
video.addEventListener("loadedmetadata", () => {
  videoPlaceholder.style.display = "none";
});

video.addEventListener("error", () => {
  videoPlaceholder.style.display = "grid";
});

video.addEventListener("timeupdate", () => {
  if (!state.watchComplete) {
    state.watchedSeconds = Math.max(state.watchedSeconds, video.currentTime);
    renderWatchProgress();
  }
});

video.addEventListener("ended", () => {
  if (!state.watchComplete && video.duration < REQUIRED_WATCH_SECONDS) {
    state.watchedSeconds = REQUIRED_WATCH_SECONDS;
    renderWatchProgress();
  }
});

demoPlayBtn.addEventListener("click", () => {
  if (state.demoTimer) return;
  demoPlayBtn.disabled = true;
  demoPlayBtn.textContent = "Demo 播放中…";
  watchLabel.textContent = "正在觀看資安宣導";

  state.demoTimer = setInterval(() => {
    state.watchedSeconds += 1;
    renderWatchProgress();

    if (state.watchedSeconds >= REQUIRED_WATCH_SECONDS) {
      clearInterval(state.demoTimer);
      state.demoTimer = null;
      demoPlayBtn.textContent = "✓ Demo 宣導已完成";
      showToast("已完成 20 秒資安宣導");
    }
  }, 1000);
});

securityChecks.forEach((check) => {
  check.addEventListener("change", () => {
    state.securityComplete = securityChecks.every((item) => item.checked);
    securityResult.classList.toggle("complete", state.securityComplete);
    securityResult.querySelector("strong").textContent = state.securityComplete ? "✓ 已完成" : "尚未完成";
    updateFooter();
  });
});

qualificationRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    qualificationCards.forEach((card) => {
      card.classList.toggle("active", card.contains(radio) && radio.checked);
      const insideRadio = card.querySelector("input");
      if (insideRadio !== radio) card.classList.toggle("active", insideRadio.checked);
    });
    calculateEstimate();
  });
});

function calculateEstimate() {
  const type = document.querySelector('input[name="qualification"]:checked').value;
  const amount = Math.max(0, Number(amountInput.value) || 0);
  const rate = type === "lowincome" ? 0.9 : 0.5;
  const cap = type === "lowincome" ? 6000 : 3000;
  const estimate = Math.min(amount * rate, cap);

  estimateRule.textContent =
    type === "lowincome"
      ? "低收／中低收入戶｜90%，最高 NT$6,000"
      : "一般青年｜50%，最高 NT$3,000";

  estimateAmount.textContent = formatMoney(estimate);
}

amountInput.addEventListener("input", () => {
  calculateEstimate();
  updateFooter();
});

[nameInput, phoneInput, toolInput].forEach((input) => {
  input.addEventListener("input", updateFooter);
});

document.querySelectorAll(".document-item").forEach((item) => {
  item.addEventListener("click", () => {
    const isOk = item.dataset.state === "ok";

    if (isOk) {
      item.dataset.state = "warning";
      item.classList.remove("ok");
      item.classList.add("warning");
      item.querySelector(".doc-status").textContent = "⚠ 待確認";
      item.querySelector(".doc-copy small").textContent = "尚未完成檢核";
    } else {
      item.dataset.state = "ok";
      item.classList.remove("warning");
      item.classList.add("ok");
      item.querySelector(".doc-status").textContent = "✓ 已通過";
      item.querySelector(".doc-copy small").textContent = "系統已完成初步格式檢核";
    }
  });
});

nextBtn.addEventListener("click", () => {
  if (state.currentStep === 1 && state.watchComplete) {
    goToStep(2);
    return;
  }

  if (state.currentStep === 2 && state.securityComplete) {
    goToStep(3);
    return;
  }

  if (state.currentStep === 3) {
    if (!validateApplication()) {
      showToast("請先完成必填資料");
      return;
    }

    nextBtn.disabled = true;
    nextBtnText.textContent = "送出中…";

    finishSubmission().finally(() => {
      // 送出失敗時使用者可能想改完資料再試一次，按鈕不能一直卡在「送出中…」。
      nextBtn.disabled = false;
      nextBtnText.textContent = "送出補助申請";
    });
  }
});

copyCaseBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(caseNumber.textContent);
    showToast("案件編號已複製");
  } catch {
    showToast(caseNumber.textContent);
  }
});

restartBtn.addEventListener("click", () => {
  state.currentStep = 1;
  state.watchedSeconds = 0;
  state.watchComplete = false;
  state.securityComplete = false;

  securityChecks.forEach((c) => c.checked = false);
  securityResult.classList.remove("complete");
  securityResult.querySelector("strong").textContent = "尚未完成";

  nameInput.value = "";
  phoneInput.value = "";
  toolInput.value = "";
  amountInput.value = "";
  estimateAmount.textContent = "NT$0";

  qualificationRadios[0].checked = true;
  qualificationCards.forEach((card, i) => card.classList.toggle("active", i === 0));

  watchLabel.textContent = "尚未完成觀看";
  watchLabel.style.color = "";
  watchTimer.textContent = `00 / ${REQUIRED_WATCH_SECONDS} 秒`;
  watchProgress.style.width = "0%";

  if (state.demoTimer) clearInterval(state.demoTimer);
  state.demoTimer = null;
  demoPlayBtn.disabled = false;
  demoPlayBtn.textContent = "沒有影片？使用 20 秒 Demo 計時";

  offlineNotice.hidden = true;

  try { video.currentTime = 0; } catch {}
  goToStep(1);
});

renderApiStatus();
calculateEstimate();
updateStepper();
updateFooter();
