// 建置：把 src/ 合成一個 dist/index.html（程式內嵌），另產 sw.js 與 manifest（SW 與 manifest 必須是獨立檔）。
// 執行期零依賴；開發期只有 esbuild。版本字串＝時間戳加內容雜湊，SW 快取名跟著換。
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

  // 不整個砍 dist：有伺服器拿 dist 當工作目錄時 Windows 會 EBUSY，只清裡面的檔
  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir)) await rm(path.join(outDir, name), { recursive: true, force: true });
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then((r) => console.log(`建置完成 ${r.version}，index.html ${r.bytes} bytes → ${r.outDir}`));
}
