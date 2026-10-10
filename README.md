# Trip Pilot

個人旅程排程 App 的程式碼：單檔 PWA、離線優先、排程規則是插件。設計文件與資料不在這個倉庫。

- `src/`：原始碼（`engine/` 核心、`rules/` 規則、`strategies/` 改案策略、`derive/` 推導表、`data/` 資料層、`ui/` 畫面）
- `tools/build.mjs`：用 esbuild 把 `src/` 合成 `dist/index.html`（程式內嵌），另產 `sw.js`、`manifest.webmanifest`
- `test/`：`node --test`；每條規則一份 snapshot

```
npm install
npm run build
npm test
```

需求：Node 22 以上（snapshot 測試）。執行期零依賴，開發期只有 esbuild。
