// 建置：把 src/ 合成一個 dist/index.html（程式內嵌），另產 sw.js 與 manifest（SW 與 manifest 必須是獨立檔）。
// 執行期零依賴；開發期只有 esbuild。版本字串＝時間戳加內容雜湊，SW 快取名跟著換。
// 用法：node tools/build.mjs [--out <資料夾>]
//   --out：建到哪個資料夾（相對於目前目錄；沒給照舊是 app/dist）。桌機伺服器供應的發布副本就是這樣建的：在 app/ 跑 node tools/build.mjs --out ../packs/app
//   （tools/serve-packs.mjs 的 /app/ 讀 packs/app，不讀 dist——開發中重建 dist 不會把半成品送到他的瀏覽器）。
import { build as esbuild } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

export async function build({ outDir = dist } = {}) {
  const app = await esbuild({
    entryPoints: [path.join(src, 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020', 'safari15'],
    write: false,
    define: { __APP_VERSION__: '"__VERSION_PLACEHOLDER__"' },
    legalComments: 'none',
    // 只去空白與註解，不改寫語法、不改名：單檔上限 400 KB（test/smoke.test.js）在 11-06 第二批（餐段、早餐、安插）之後不壓縮會超過。
    // 11-12 量的（頁面外殼＋程式，bytes）：不壓縮 449,803、只去空白 347,848、再加語法縮寫 336,089、全開（含改名）278,845。
    // 取只去空白：過得了上限（409,600）、還有 61,752；函式與變數的名字都還在，手機上出錯時看到的名字對得回原始碼（沒有 source map）。之後再長到不夠才往下一級開
    minifyWhitespace: true,
  });
  const appCode = app.outputFiles[0].text;
  const version = `${stamp()}-${createHash('sha256').update(appCode).digest('hex').slice(0, 8)}`;
  const template = await readFile(path.join(src, 'index.html'), 'utf8');
  if (!template.includes('<!--APP-->')) throw new Error('index.html 缺 <!--APP--> 佔位');
  const html = template.replace('<!--APP-->', `<script>${appCode.replaceAll('__VERSION_PLACEHOLDER__', version).replaceAll('</script', '<\\/script')}</script>`);
  const sw = (await readFile(path.join(src, 'sw.js'), 'utf8')).replace(
    /const VERSION = [^;]+;/,
    `const VERSION = ${JSON.stringify(version)};`,
  );
  const manifest = await readFile(path.join(src, 'manifest.webmanifest'), 'utf8');

  // 不整個砍 dist：有伺服器拿 dist 當工作目錄時 Windows 會 EBUSY，只清裡面的檔。
  // 清之前先看一眼：資料夾不是空的、又不像上一次的建置產物（沒有 index.html 與 sw.js）就不清、丟錯——--out 打錯資料夾（例如 ../packs）不會把裡面的東西刪光
  await mkdir(outDir, { recursive: true });
  const old = await readdir(outDir);
  if (old.length && !(old.includes('index.html') && old.includes('sw.js'))) throw new Error(`${outDir} 不是空的、也不像上一次的建置產物（沒有 index.html 與 sw.js），不清它；請換一個資料夾`);
  for (const name of old) await rm(path.join(outDir, name), { recursive: true, force: true });
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  await writeFile(path.join(outDir, 'sw.js'), sw, 'utf8');
  await writeFile(path.join(outDir, 'manifest.webmanifest'), manifest, 'utf8');
  // 圖示：src/icons/*.png 原樣複製（來源是 src/icons/icon.html 用 Playwright 截的；沒有就跳過）
  const iconsDir = path.join(src, 'icons');
  if (existsSync(iconsDir)) {
    const pngs = (await readdir(iconsDir)).filter((n) => n.endsWith('.png'));
    if (pngs.length) await mkdir(path.join(outDir, 'icons'), { recursive: true });
    for (const n of pngs) await copyFile(path.join(iconsDir, n), path.join(outDir, 'icons', n));
  }
  return { version, bytes: Buffer.byteLength(html, 'utf8'), outDir };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 命令列 → build 的參數：--out <資料夾> 或 --out=<資料夾>（相對於目前目錄）；一個參數都沒給回 {}＝照舊建到 dist（npm run build）。
 * 不認得的參數一律丟錯，不當成沒給（11-12 畫面審查）：之前只找 '--out' 這個字，--out=資料夾、-o、--Out（大小寫打錯）、漏打旗標只寫資料夾，都默默建到 app/dist——
 * 桌機伺服器換成讀 packs/app 之前 dist 還在供應他的瀏覽器，打錯一次就把開發中的版本送出去。旗標後面沒接值、接的是另一個旗標也丟錯。
 */
export function parseArgs(argv, cwd = process.cwd()) {
  const usage = '用法：node tools/build.mjs [--out <資料夾>]';
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || String(v).startsWith('-')) throw new Error(`--out 後面要接一個資料夾（${usage}）`);
      out = String(v); i += 1;
    } else if (a.startsWith('--out=')) {
      out = a.slice('--out='.length);
      if (!out) throw new Error(`--out 後面要接一個資料夾（${usage}）`);
    } else throw new Error(`不認得的參數：${a}（${usage}）`);
  }
  return out == null ? {} : { outDir: path.resolve(cwd, out) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 參數也在這條 promise 鏈裡解析：打錯時只印那一句、exit 1，不印整段錯誤堆疊，也不會建任何東西
  Promise.resolve()
    .then(() => build(parseArgs(process.argv.slice(2))))
    .then((r) => console.log(`建置完成 ${r.version}，index.html ${r.bytes} bytes → ${r.outDir}`))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
