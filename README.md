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
- `assets/hacker-room.png`：使用者本次 Higgsfield 生成影片的第 0 秒畫面（1280 × 720）。保留駭客貓原畫，以 HTML 圖層覆蓋原畫中的標題與電腦螢幕文字。所有服務文字都是可編輯、可選取的 HTML，沒有沿用影片中的變形字。

首頁是原畫搭配網頁轉場，並非自動播放完整影片。JavaScript 不可用時仍可由頁首連結或下方基本選單前往 subsidy。

### 本機預覽

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

開啟 `http://127.0.0.1:8766/`。確認首頁、點擊螢幕、服務導向、Escape 返回、手機直向與橫向皆可操作後，再推送部署。`subsidy/` 原有申請流程未改動。
