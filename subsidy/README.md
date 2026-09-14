# 竹青 AI PASS｜LINE LIFF Demo

這是一個可直接用 Cursor 開啟修改的黑客松 Demo。前端沒有建置步驟，但送出申請時會真的打到承辦端的 API（見下方「收件 API」）。

## 內容
- STEP 01：20 秒 AI 資安宣導
- STEP 02：AI 安全三問
- STEP 03：補助申請、補助試算、智慧文件檢核
- STEP 04：案件編號、審核／核銷／撥款進度 Timeline
- LINE 服務串聯視覺
- 手機優先 Responsive UI
- Sticky CTA
- 基本微動畫

## 檔案結構

hc_ai_liff_demo/
├─ index.html
├─ styles.css
├─ app.js
├─ README.md
└─ assets/
   └─ security-awareness.mp4   ← 你們自己的影片放這裡

## 如何開啟

### 最快方式
1. 用 Cursor 開啟整個 `hc_ai_liff_demo` 資料夾
2. 安裝 Cursor / VS Code 的 Live Server extension
3. 右鍵 `index.html`
4. 選 `Open with Live Server`

### 或使用 Python
在資料夾 Terminal 執行：

python3 -m http.server 5500

然後開：

http://localhost:5500

## 放入你們的宣導影片

把影片改名為：

security-awareness.mp4

放到：

assets/security-awareness.mp4

如果沒有影片，畫面會自動顯示「20 秒 Demo 計時」按鈕，讓你們先展示流程。

## 收件 API

送出申請時會 `POST {API_BASE}/api/applications`，成功的話拿到伺服器發的 `YOUTH-NNN` 案件編號，那個編號在 LINE Bot 的「查詢進度」查得到。

`API_BASE` 不寫死在程式裡——承辦端是本機 Express 透過 ngrok 對外，網址每次重開都不一樣。設定方式有兩種：

1. 網址帶參數：`?api=https://xxxx.ngrok-free.app`（讀進來後會存進 `localStorage` 並從網址移除）
2. 頁面最上方的「連線設定」按鈕，現場直接改

**沒設定或連不上時會退回本機產生的假編號 `HC-AI-YYMMDD-NNNN` 並顯示警告，不會整頁卡住。** 那種編號送不到承辦端，bot 也查不到。

請求會帶 `ngrok-skip-browser-warning: 1`，否則 ngrok 免費版會先回一頁 HTML 攔截頁，`fetch().json()` 直接爆掉。

姓名與手機會真的存進承辦端的展示資料庫，**請填假資料**。

## 下一步串 LINE LIFF 時要改的地方

登入目前是畫面上的假狀態，還沒接真的 LIFF。正式串 LIFF 時：
1. 引入 LIFF SDK
2. `liff.init({ liffId: "你的 LIFF ID" })`
3. 使用 `liff.login()`
4. 使用 `liff.getProfile()` 取得 displayName / userId
5. 不要把 userId 顯示在畫面上
6. 送出時把 userId 一起帶給後端，案件才綁得到人

後端已經有的部分：`POST /api/applications` 收件、寫進 SQLite、行政後台可以改狀態。還沒做的是 Messaging API 依狀態主動推播——目前要使用者自己在 bot 裡查。

案件狀態用中文，共五種：`待審`、`補件中`、`已核准`、`核銷中`、`已撥款`。

## 顏色
- Navy: #151B4D
- Blue: #3457E6
- LINE Green: #06C755
