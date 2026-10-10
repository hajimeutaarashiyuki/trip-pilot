// T1 驗收：店型推導、係數、恢復站、停留解析；仙台 136 筆全部通過並把分佈存成 snapshot 對照 profile §2.4。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePoi, normalizeAll, classifyCategory, parseDurationMin } from '../../src/data/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// 知識庫在私人倉庫（專案根目錄），公開倉庫裡沒有；本機有就跑，沒有就跳過。
const SENDAI = path.resolve(here, '../../../kb/sendai/data.json');

test('店型由自由文字推：古著店 0、百貨 1.0 且 walkAround、喫茶是恢復站且咖啡廳類', () => {
  const v = normalizePoi({ name_zh: 'Utah', category: '古著店（高階美式）', duration: '60 分鐘' }).poi;
  assert.equal(v.category, 'vintage'); assert.equal(v.walkFactor, 0); assert.equal(v.recovery, false); assert.equal(v.dwellMin, 60);
  const d = normalizePoi({ name_zh: '藤崎', category: '百貨公司（精品）' }).poi;
  assert.equal(d.category, 'department'); assert.equal(d.walkFactor, 1); assert.equal(d.walkAround, true);
  const c = normalizePoi({ name_zh: 'Elbe', category: '昭和純喫茶（1954年創業）' }).poi;
  assert.equal(c.category, 'cafe'); assert.equal(c.recovery, true); assert.equal(c.cafeLike, true); assert.equal(c.walkFactor, 0);
  const s = normalizePoi({ name_zh: '瑞巌寺', category: '寺院（國寶・臨濟宗）', duration: '1.5 小時' }).poi;
  assert.equal(s.category, 'temple'); assert.equal(s.walkFactor, 0.5); assert.equal(s.dwellMin, 90);
});

test('明寫的欄位優先於推導；書店走 0.5；錢湯帶打包待辦', () => {
  const p = normalizePoi({ name_zh: 'X', category: '古著店', walkFactor: 0.5, recovery: true, dwellMin: 45 }).poi;
  assert.equal(p.walkFactor, 0.5); assert.equal(p.recovery, true); assert.equal(p.dwellMin, 45);
  const b = normalizePoi({ name_zh: '阿武隈書房', category: 'bookstore' }).poi;
  assert.equal(b.walkFactor, 0.5);
  const o = normalizePoi({ name_zh: '駒の湯', category: '錢湯' }).poi;
  assert.equal(o.category, 'onsen'); assert.deepEqual(o.prepNeeded, ['毛巾', '換洗衣物']);
});

test('缺資料不炸：看不懂的店型→other 並警告；沒座標、沒結構化營業時間各一條警告；爬坡沒分鐘警告', () => {
  const r = normalizePoi({ name_zh: '???', category: '火星', climb: true });
  assert.equal(r.poi.category, 'other');
  const codes = r.warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ['category-unknown', 'climb-no-minutes', 'coords-missing', 'hours-missing']);
});

test('停留時間解析', () => {
  assert.equal(parseDurationMin('45-60 分鐘'), 55);
  assert.equal(parseDurationMin('1.5 小時'), 90);
  assert.equal(parseDurationMin('5–7 小時'), 360);
  assert.equal(parseDurationMin('約 1–1.5 小時（含數珠製作體驗）'), 75);
  assert.equal(parseDurationMin('看心情'), null);
  assert.equal(classifyCategory('交通｜觀光巴士').key, 'logistics');
});

test('仙台 136 筆全部通過 normalize，分佈進 snapshot', { skip: !existsSync(SENDAI) && '本機沒有 kb/sendai/data.json' }, async (t) => {
  const kb = JSON.parse(await readFile(SENDAI, 'utf8'));
  const list = Object.values(kb.categories).flatMap((v) => (Array.isArray(v) ? v : v.items ?? []));
  const { pois, warnings, stats } = normalizeAll(list);
  assert.equal(pois.length, 136);
  assert.ok(pois.every((p) => p.id && p.category && typeof p.walkFactor === 'number'));
  const unknown = warnings.filter((w) => w.code === 'category-unknown');
  // 看不出店型的要列出來，目標是 0；現在有幾筆就是研究要補店型的清單
  t.assert.snapshot({ stats, unknown: unknown.map((w) => w.msg).sort() });
});
