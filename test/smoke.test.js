// 煙霧測試：建置得出單檔、沒有外部 script、SW 與 manifest 存在、版本有注入。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../tools/build.mjs';

test('建置產出單檔 PWA', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'trip-pilot-build-'));
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
  assert.ok(result.bytes < 300 * 1024, `單檔超過 300 KB：${result.bytes}`);
  assert.doesNotMatch(html, /undefined|\[object Object\]|�/, '產出含垃圾字串');
});
