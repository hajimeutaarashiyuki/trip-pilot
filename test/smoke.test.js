// 煙霧測試：建置得出單檔、沒有外部 script、SW 與 manifest 存在、版本有注入；命令列 --out 建到別的資料夾（桌機伺服器的發布副本）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, parseArgs } from '../tools/build.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('建置產出單檔 PWA', async (t) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'trip-pilot-build-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));   // 之前不清，系統暫存夾每跑一次多一個資料夾
  const result = await build({ outDir });
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  const sw = await readFile(path.join(outDir, 'sw.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.webmanifest'), 'utf8'));

  assert.match(html, /<title>Trip Pilot<\/title>/);
  assert.doesNotMatch(html, /<script[^>]+src=/, '單檔裡不得有外部 script');
  assert.doesNotMatch(html, /__VERSION_PLACEHOLDER__/, '版本沒注入');
  assert.ok(html.includes(result.version), '頁面要帶建置版本');
  assert.ok(sw.includes(`const VERSION = "${result.version}"`), 'SW 快取名要跟著版本');
  assert.equal(manifest.display, 'standalone');
  // 單檔上限只是擋肥大（例如把知識庫誤打進來）。10-16 T26 需求單頁：之前 196,564 bytes（HEAD 重建量的）、之後 240,596（建置 202610161325-27bd839b）、審查後修正 243,883（202610161354-f1e8b79e），200 KB 原本只剩 8 KB 餘裕，提到 300 KB
  // 10-16 T15–T19 五項功能 +49 KB（244,183 → 293,172，建置 202610161737-10e79285），300 KB 只剩 7 KB，提到 400 KB；打包檔本體 2 MB 另外下載、不在這裡
  // 11-06 第二批（餐段、早餐、安插）不壓縮會到 449,803：上限不動，建置改成只去空白與註解（tools/build.mjs minifyWhitespace；11-12 量到 347,848，四種壓法的數字在那邊）
  assert.ok(result.bytes < 400 * 1024, `單檔超過 400 KB：${result.bytes}`);
  assert.doesNotMatch(html, /undefined|\[object Object\]|�/, '產出含垃圾字串');
  // 去空白不改名：函式的名字還在（手機上出錯時看到的名字對得回原始碼）
  assert.match(html, /function renderPlanner\(/);
});

test('命令列 --out：建到指定的資料夾（相對於目前目錄）、不碰 dist；旗標沒接值丟錯；資料夾不是空的、又不像上一次的建置產物就不清', async (t) => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'trip-pilot-build-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  assert.deepEqual(parseArgs([]), {}, '沒給＝照舊建到 dist');
  assert.deepEqual(parseArgs(['--out', 'pub/app'], tmp), { outDir: path.join(tmp, 'pub', 'app') });
  assert.deepEqual(parseArgs(['--out', path.join(tmp, 'abs')], 'D:\\elsewhere'), { outDir: path.join(tmp, 'abs') }, '絕對路徑照用');
  for (const argv of [['--out'], ['--out', '--verbose']]) assert.throws(() => parseArgs(argv), /--out 後面要接一個資料夾/);
  // 11-12 畫面審查：打錯的參數不當成沒給（之前這幾種都回 {}＝默默建到 app/dist）；--out=<資料夾> 也收
  assert.deepEqual(parseArgs(['--out=pub/app'], tmp), { outDir: path.join(tmp, 'pub', 'app') });
  for (const argv of [['-o', 'x'], ['--Out', 'x'], ['x'], ['--out', 'a', 'b'], ['--outdir=x'], ['--verbose'], ['--out', 'a', '--out']]) assert.throws(() => parseArgs(argv), /不認得的參數|--out 後面要接一個資料夾/, argv.join(' '));
  for (const argv of [['-o', 'x'], ['--Out', 'x'], ['x'], ['--out', 'a', 'b']]) assert.throws(() => parseArgs(argv), /不認得的參數：/, argv.join(' '));
  for (const argv of [['--out='], ['--out', '-o']]) assert.throws(() => parseArgs(argv), /--out 後面要接一個資料夾/, argv.join(' '));

  const distHtml = path.join(APP, 'dist', 'index.html');
  const distBefore = existsSync(distHtml) ? (await stat(distHtml)).mtimeMs : null;
  const run = (...args) => spawnSync(process.execPath, [path.join(APP, 'tools', 'build.mjs'), ...args], { cwd: tmp, encoding: 'utf8' });
  const first = run('--out', 'pub/app');
  assert.equal(first.status, 0, first.stderr);
  const out = path.join(tmp, 'pub', 'app');
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) assert.ok(existsSync(path.join(out, f)), f);
  assert.match(await readFile(path.join(out, 'index.html'), 'utf8'), /<title>Trip Pilot<\/title>/);
  assert.equal(existsSync(distHtml) ? (await stat(distHtml)).mtimeMs : null, distBefore, 'app/dist 沒被動');
  // 同一個資料夾再建一次（裡面是上一次的建置產物）：照常
  await writeFile(path.join(out, 'stale.txt'), 'x');
  assert.equal(run('--out', 'pub/app').status, 0);
  assert.ok(!existsSync(path.join(out, 'stale.txt')), '上一次的產物清掉重建');
  // 打錯資料夾（裡面有別的東西、不像建置產物）：不清、丟錯
  const packs = path.join(tmp, 'packs');
  await mkdir(packs);
  await writeFile(path.join(packs, 'pack.json'), '{}');
  await assert.rejects(build({ outDir: packs }), /不是空的、也不像上一次的建置產物/);
  const bad = run('--out', 'packs');
  assert.equal(bad.status, 1);
  assert.equal(await readFile(path.join(packs, 'pack.json'), 'utf8'), '{}', '裡面的東西還在');
  assert.ok(!existsSync(path.join(packs, 'index.html')));
  // 參數打錯（上面已驗過 parseArgs 會丟錯，這裡才敢真的跑命令列）：exit 1、只印一句（不是整段錯誤堆疊）、什麼都沒建、dist 沒被動
  for (const args of [['--Out', 'pub/typo'], ['pub/typo'], ['--out']]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, `只印一句：${r.stderr}`);
    assert.match(r.stderr, /不認得的參數|--out 後面要接一個資料夾/);
    assert.doesNotMatch(r.stderr, /\bat \S+ \(|node:internal/, '不印錯誤堆疊');
  }
  assert.ok(!existsSync(path.join(tmp, 'pub', 'typo')));
  assert.equal(existsSync(distHtml) ? (await stat(distHtml)).mtimeMs : null, distBefore, 'app/dist 沒被動');
});
