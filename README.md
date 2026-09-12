# 竹青 AI PASS｜LINE LIFF Demo

這是一個純前端、可直接用 Cursor 開啟修改的黑客松 Demo。

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

## 下一步串 LINE LIFF 時要改的地方

目前是 UI Prototype。

正式串 LIFF 時：
1. 引入 LIFF SDK
2. `liff.init({ liffId: "你的 LIFF ID" })`
3. 使用 `liff.login()`
4. 使用 `liff.getProfile()` 取得 displayName / userId
5. 不要把 userId 顯示在畫面上
6. 送申請時，把資料 POST 到你們的 backend API
7. backend 將案件狀態寫入 DB
8. Messaging API 依案件狀態主動推播 LINE 訊息

## 建議後端 API
POST /api/applications
GET  /api/applications/:id
PATCH /api/applications/:id/status

## 建議案件狀態
submitted
reviewing
needs_more_info
approved
reimbursement
paid

## 顏色
- Navy: #151B4D
- Blue: #3457E6
- LINE Green: #06C755
