// 「剛按完更新」與「重開頁面之後」記憶體裡要是同一份資料（11-24 對抗審查第 1 項；主控裁決乙1）：
// 之前按「更新」那一次拿打包檔直接載入（POI 是打包檔的先後），重開頁面是從 IndexedDB 讀回來（POI 是 id 的排序）——引擎同分時照池子的順序取，
// 兩邊排出來的行程、換一家清單、走廊清單會不一樣（真的打包檔上量到：公務版 8/15 的行程、七天包 10／45 份換一家清單）。
// 現在按完「更新」也從 IndexedDB 讀回來再載入（跟重開頁面同一條路），讀回來照打包檔的先後。這裡用假的 IndexedDB（test/_idb.js）與假 DOM 把 app.js 真的跑一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom.js';
import { installIdb } from '../_idb.js';
import { makeTrip, WORLD, JP, kb, THU } from './_world.js';
import { PACK_FORMAT, PACK_VERSION } from '../../src/data/pack.js';
import { slugId } from '../../src/data/schema.js';

installIdb();
const dom = installDom();   // 兩個都要在 app.js 載入之前
const app = await import('../../src/ui/app.js');
const store = await import('../../src/data/store.js');
const { state } = app;

// 打包檔會把每筆 POI 的 id 規範化（小寫、標點換成連字號）：小世界的 id 先照同一個函式換好，旅程檔裡指到的 id 跟著換
const sid = (id) => slugId({ id });
const pois = WORLD.map((p) => ({ ...p, id: sid(p.id) }));
function tripOf() {
  const t = makeTrip();
  for (const d of t.days) {
    d.picks = d.picks.map((p) => ({ ...p, poiId: sid(p.poiId) }));
    if (d.pinned) d.pinned = { ...d.pinned, sequence: d.pinned.sequence.map((e) => ({ ...e, poiId: sid(e.poiId) })) };
  }
  return t;
}
const packOf = (at = '2026-11-24T00:00:00.000Z') => ({ meta: { format: PACK_FORMAT, version: PACK_VERSION, generatedAt: at, cityId: 'c', tripId: 'ui-world' }, city: { id: 'c', name_zh: '小城' }, country: JP, zones: { zones: kb.zones, links: {} }, pois, walk: { pairs: {} }, trip: tripOf(), rules: null });
const ORDER = pois.map((p) => p.id);
const sorted = [...ORDER].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** 記憶體裡跟排程有關的每一樣，轉成可以逐字比的字串：知識庫每一筆（照先後）、候選池的先後、旅程檔、區與國家層、每天排出來的站與時刻、排不進、走廊清單、二選一。 */
function memory() {
  return JSON.stringify({
    pois: Object.entries(state.pois), pool: state.pool.map((c) => c.poi.id), trip: state.trip, kb: state.kb, country: state.country, packRules: state.packRules, packMeta: state.packMeta,
    plans: Object.values(state.plans).map((x) => ({
      date: x.date, seq: x.plan.sequence.map((s) => [s.poi.id, s.startMin, s.endMin, s.insertedBy ?? null]), dropped: x.plan.dropped.map((q) => q.poi.id), score: x.plan.score,
      corridor: (x.plan.corridor ?? []).map((c) => [c.legIndex, c.pois.map((q) => q.poi.id)]), choices: (x.plan.choices ?? []).map((c) => c.options),
    })),
  });
}

test('按完「更新」記憶體裡的知識庫照打包檔的先後；重開頁面（從 IndexedDB 讀回來）逐筆相同、排出來的每一天也相同', async () => {
  assert.notDeepEqual(ORDER, sorted, '夾具：打包檔的先後跟 id 的排序不同');
  dom.storage.clear();
  await app.applyPackJson(packOf());
  assert.match(state.packStatus, /^更新好了：小世界/);
  assert.deepEqual(Object.keys(state.pois), ORDER, '知識庫照打包檔的先後');
  assert.deepEqual(state.pool.map((c) => c.poi.id), ORDER, '候選池同一個先後');
  assert.ok(state.plans[THU].plan.sequence.length > 0, '有排出行程');
  const afterUpdate = memory();
  // 重開頁面：boot 走的那條路（store.js loadLatestPack → loadFromPack）
  app.loadFromPack(await store.loadLatestPack());
  assert.deepEqual(Object.keys(state.pois), ORDER, '重開之後也是打包檔的先後（之前是 id 的排序）');
  assert.equal(memory(), afterUpdate, '重開前後逐筆相同');
  // 再重開一次也一樣
  app.loadFromPack(await store.loadLatestPack());
  assert.equal(memory(), afterUpdate);
});

test('按「更新」收的是另一趟、打包時間比手機裡那一趟舊：畫面顯示剛收的這一趟（不是打包時間最新的那一趟），知識庫照它那一包的先後', async () => {
  dom.storage.clear();
  await app.applyPackJson(packOf('2026-11-24T00:00:00.000Z'));
  const older = packOf('2026-11-01T00:00:00.000Z');
  older.trip = { ...older.trip, id: 'ui-world-older', name: '比較舊的那一趟' };
  older.meta = { ...older.meta, tripId: 'ui-world-older' };
  older.pois = [...older.pois].reverse();
  await app.applyPackJson(older);
  assert.equal(state.trip.id, 'ui-world-older');
  assert.deepEqual(Object.keys(state.pois), [...ORDER].reverse());
  assert.match(state.packStatus, /^更新好了：比較舊的那一趟/);
});
