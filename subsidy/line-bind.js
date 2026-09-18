/**
 * LIFF 一鍵綁定頁。
 *
 * 動線：收件回執按下按鈕 → liff.line.me/<liffId>?token=…&api=… → LINE 開啟本頁
 *       → liff.init() → 取 ID token → POST /api/applications/line-binding → 完成。
 *
 * 為什麼要有 ID token：綁定碼證明「這個瀏覽器剛送出了這一件申請」，但證明不了操作的人
 * 是誰。舊版用「請使用者傳一句訊息給官方帳號」補上後半段——webhook 收到訊息時就知道
 * userId 了。ID token 讓同一件事在網頁裡完成，所以桌機也能綁，而且不必傳訊息。
 *
 * **不要把驗證搬到前端。** 這一頁只負責把 LINE 給的 token 原封不動轉交給伺服器，
 * 簽章與 aud 都由後端打 LINE 的 verify 端點驗；前端自己解開 JWT 來讀 sub 等於沒驗。
 */

/**
 * 讀出網址上的參數。
 *
 * 這裡不能只看 `location.search`。LIFF 的 Endpoint URL 自己帶了路徑（/subsidy/line-bind.html），
 * 所以 LINE 不會把 `?token=…&api=…` 直接接在後面，而是整串塞進 `liff.state`，長得像：
 *
 *   line-bind.html?liff.state=%3Ftoken%3Dxxxx%26api%3Dhttps%3A%2F%2F…
 *
 * `liff.init()` 之後 SDK 會把它還原回網址，但我們在 init 之前就要拿 token（沒有 token 連
 * 初始化都不必做），所以自己解一次。兩種形式都要支援：endpoint 沒帶路徑時走前者。
 */
function readParams() {
  const search = new URLSearchParams(location.search);
  const state = search.get('liff.state');
  if (state) {
    for (const [key, value] of new URLSearchParams(state.replace(/^\?/, ''))) {
      if (!search.has(key)) search.set(key, value);
    }
  }
  return search;
}

const params = readParams();
const titleEl = document.getElementById('bind-title');
const textEl = document.getElementById('bind-text');
const actionsEl = document.getElementById('bind-actions');

/** ngrok 免費版預設會先回一頁 HTML 攔截頁，這個標頭是官方指定的跳過方式。 */
const NGROK_HEADER = { 'ngrok-skip-browser-warning': '1' };

function normalizeApiBase(value) {
  const base = String(value ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/.test(base) ? base : '';
}

/**
 * 找不到 API 位址時的退路。**要和 app.js 的 DEFAULT_API_BASE 保持一致。**
 *
 * 兩支腳本各自獨立載入、沒有共用模組，所以這個值只能抄一份。改一邊就要改另一邊。
 */
const DEFAULT_API_BASE = '';

/**
 * API 位址。優先用收件頁傳過來的 `?api=`；沒有就看本頁是不是伺服器自己 serve 的（同源）；
 * 再不然用預設位址。
 *
 * 前兩種情況都會真的發生：LIFF endpoint 指到 ngrok 時是同源，指到 GitHub Pages 時不是。
 * 第三層是為了 endpoint 設在 GitHub Pages、而網址又不知怎麼掉了 `?api=` 的情況——
 * 那時 location.origin 是 github.io，打過去只會拿到 404 的 HTML。
 */
const apiBase = normalizeApiBase(params.get('api'))
  || (location.hostname.endsWith('.github.io') ? DEFAULT_API_BASE : location.origin)
  || location.origin;
const token = String(params.get('token') ?? '').trim();

function render(title, text, buttons = []) {
  titleEl.textContent = title;
  textEl.textContent = text;
  actionsEl.replaceChildren();
  for (const button of buttons) {
    const el = document.createElement(button.href ? 'a' : 'button');
    el.className = button.variant === 'ghost' ? 'bind-btn bind-btn-ghost' : 'bind-btn';
    el.textContent = button.label;
    if (button.href) el.href = button.href;
    else {
      el.type = 'button';
      el.addEventListener('click', button.onClick);
    }
    actionsEl.append(el);
  }
  actionsEl.hidden = buttons.length === 0;
}

/** 在 LINE 內開啟時，完成後給一顆關掉視窗的按鈕；外部瀏覽器沒有這個能力。 */
function closeButton() {
  if (typeof liff === 'undefined' || !liff.isInClient?.()) return [];
  return [{ label: '關閉視窗', variant: 'ghost', onClick: () => liff.closeWindow() }];
}

async function fetchLiffId() {
  const response = await fetch(`${apiBase}/api/applications/program`, { headers: NGROK_HEADER });
  if (!response.ok) throw new Error(`伺服器回應 ${response.status}`);
  const data = await response.json();
  const liffId = data?.lineLogin?.liffId ?? '';
  if (!liffId) throw new Error('伺服器尚未設定 LIFF');
  return liffId;
}

async function bind(idToken) {
  const response = await fetch(`${apiBase}/api/applications/line-binding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...NGROK_HEADER },
    body: JSON.stringify({ token, idToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `伺服器回應 ${response.status}`);
  return data;
}

async function main() {
  if (!token) {
    render('綁定連結不完整', '這條網址少了綁定碼。請回到申請完成頁，重新點一次「用 LINE 一鍵綁定通知」。');
    return;
  }

  let liffId;
  try {
    liffId = await fetchLiffId();
  } catch (error) {
    render('連不上收件伺服器', `${error.message}。請確認伺服器與 ngrok 都還開著，再重新點一次綁定按鈕。`);
    return;
  }

  try {
    await liff.init({ liffId });
  } catch (error) {
    render('LINE 初始化失敗', `${error.message}。請確認 LIFF 的 Endpoint URL 與目前網址相同。`);
    return;
  }

  // 在 LINE App 裡開啟時已經是登入狀態；外部瀏覽器才會真的跳一次 LINE Login。
  // redirectUri 帶完整網址（含 query），登入回來才不會掉了綁定碼。
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return;
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    // 幾乎都是 LIFF app 沒勾 openid scope。錯誤訊息直接講出來，省下一輪猜測。
    render('拿不到 LINE 憑證', '請到 LINE Developers Console 確認這個 LIFF app 的 Scopes 有勾選 openid，然後重新點一次綁定按鈕。');
    return;
  }

  render('綁定中', '正在向伺服器確認…');

  let result;
  try {
    result = await bind(idToken);
  } catch (error) {
    render('綁定失敗', `${error.message}`, closeButton());
    return;
  }

  // isFriend 是 null 代表查不出來（例如 token 沒設或 LINE 暫時不通）。
  // 這時不要亂講，綁定確實成功了，只是沒辦法保證推播收得到。
  if (result.isFriend === false) {
    render(
      '綁定成功，還差一步',
      `案件 ${result.caseCode} 已綁定，但你還不是「竹青 AI 安心辦」的好友，這樣通知送不到。請先加好友。`,
      [{ label: '加入官方帳號好友', href: result.addFriendUrl }, ...closeButton()],
    );
    return;
  }

  render(
    '綁定成功',
    `案件 ${result.caseCode} 的審核結果會由官方帳號通知你。請不要封鎖或刪除這個帳號。`,
    closeButton(),
  );
}

main().catch((error) => {
  render('發生未預期的錯誤', String(error?.message ?? error));
});
