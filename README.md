# 竹青 AI 安心辦｜網站集合

集中存放黑客松專案的靜態展示網站。每個網站使用獨立子資料夾，可由 GitHub Pages 分別開啟。

## 網站

- [`subsidy/`](./subsidy/)：AI 領航青年數位工具補助申請 Demo

## 公開網址

- 網站入口：https://shaochilin.github.io/hc-ai-pass-websites/
- 補助網站：https://shaochilin.github.io/hc-ai-pass-websites/subsidy/

## 新增網站

在根目錄新增一個資料夾，並把該網站的 `index.html` 與相關檔案放入其中。所有內容均為黑客松展示用途，請勿放入憑證、個人資料或正式環境資料。

## 漫畫首頁

首頁使用原生 HTML、CSS、JavaScript，無需安裝套件或建置。點擊電腦或「點亮電腦」會把螢幕平滑放大為服務選單；AI 領航連到相對路徑 `./subsidy/`，可直接部署在現有 GitHub Pages 子目錄。

- `home.css`：版面、配色、動畫、字體。修改 `--font-title` 可更換標題字體，`--font-body` 控制內文。目前使用系統繁中黑體（macOS/iOS 為蘋方、Windows 為微軟正黑體），不需外部字型請求。若指定自訂字體，需同時提供有授權的字型檔與 `@font-face`。
- `home.js`：螢幕四角投影、放大／返回、焦點管理。支援 Escape、瀏覽器上一頁、`#services` 直接進入選單、視窗尺寸改變，以及系統的減少動態效果設定。
- `assets/mascot-room.png`、`assets/mascot-typing.png`：根據使用者提供的吉祥物參考圖，以內建 imagegen 編輯的背景與另一個打字姿勢。手臂區域以 CSS 每 0.56 秒交替播放，頭部、尾巴、桌面與螢幕保持穩定。生成提示詞見 [`assets/mascot-generation.md`](./assets/mascot-generation.md)。
- `assets/hacker-room.png`：原 Higgsfield 影片的第 0 秒畫面，保留作為來源；目前首頁已改用吉祥物素材。所有服務文字仍是可編輯、可選取的 HTML。
- `particles.js`：游標移動產生青藍粒子、方格與電路折線；上限 80 顆，約 0.6–1.25 秒消散，閒置時停止繪製。觸控不產生游標粒子，減少動態效果設定會停用裝飾動畫；隱藏分頁暫停動畫，選單開啟時停止粒子與打字。

首頁是原畫搭配網頁轉場，並非自動播放完整影片。JavaScript 不可用時仍可由頁首連結或下方基本選單前往 subsidy。

### 本機預覽

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

開啟 `http://127.0.0.1:8767/`。確認首頁、點擊螢幕、服務導向、Escape 返回、手機直向與橫向皆可操作後，再推送部署。`subsidy/` 原有申請流程未改動。

### 動畫檢查

```sh
node --test tests/particles.test.cjs
node --check home.js
node --check particles.js
```

粒子測試涵蓋自動停止、粒子及解析度上限、觸控與減少動態效果、背景分頁，以及視窗尺寸變更。
