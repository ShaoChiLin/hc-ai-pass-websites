# 台北修繕通｜民眾端

INNOSERVE 競賽展示用的一站式報修網站。根目錄是民眾端，提供四步驟報修、JPG／PNG／PDF 附件、案件進度追蹤，以及 LINE／Email 通知偏好。

完整模式由 `hc-ai-pass-admin/server` 同源提供：

```powershell
cd ..\hc-ai-pass-admin\server
pnpm install
node src\index.js
```

- 民眾端：http://127.0.0.1:3000/report/
- 承辦後台：http://127.0.0.1:3000/repair-admin/
- 展示帳號：`demo`
- 展示密碼：`innoserve2026`

只看靜態畫面時，也可以在本目錄執行 `python -m http.server 8767`；此模式不會寫入資料庫。

前端核心測試：

```powershell
node --test tests\repair-core.test.cjs tests\image-check.test.cjs tests\document-check.test.cjs tests\particles.test.cjs
```

`subsidy/` 保留原專案的青年數位工具補助展示頁，不影響報修系統。
