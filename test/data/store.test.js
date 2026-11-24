// 手機的資料層（src/data/store.js）：收打包檔寫進 IndexedDB、再讀回來。用假的 IndexedDB（test/_idb.js：讀整批時照主鍵排，跟真的一樣）。
// 11-24 對抗審查第 1 項：POI 是一筆一筆存的，用索引整批讀回來的順序是 id 的排序、不是打包檔的順序；引擎幾個「取前幾家」同分時照池子的順序，
// 所以「剛按完更新」（記憶體裡是打包檔的順序）與「重開頁面之後」（id 的順序）排出來的行程、換一家清單、走廊清單會不一樣（公務版 8/15 的行程變了）。
// 修法（主控 11-24 傍晚裁決乙1 的落地）：存的時候把這一包每筆 POI 的 id 照打包檔的先後記在旅程那一筆上（poiOrder），讀回來照它排、也只拿名單上的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installIdb } from '../_idb.js';
import { buildPack, readPack, packFromStore } from '../../src/data/pack.js';
import { DB_NAME } from '../../src/data/migrations.js';

const idb = installIdb();   // 要在 store.js 第一次開資料庫之前
const store = await import('../../src/data/store.js');

// 打包檔裡的先後故意跟 id 的排序不一樣
const ORDER = ['zeta', 'alpha', 'mid', 'beta', 'omega', 'delta'];
const raw = (id, over = {}) => ({ id, name_zh: `店 ${id}`, category: 'cafe', lat: 38.26, lng: 140.87, hours: { mon: [['09:00', '18:00']] }, ...over });
const sortedIds = (ids) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
function packOf({ tripId = 't1', ids = ORDER, at = '2026-11-24T00:00:00.000Z', over = {} } = {}) {
  return buildPack({
    city: { id: 'c', name_zh: '城' },
    country: { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, utcOffsetMin: 540 },
    // 區、連結、步行矩陣的鍵也故意不照字母排：這幾樣整包存在旅程那一筆裡，讀回來鍵的先後要原樣
    zones: { zones: { zb: { lat: 1, lng: 2 }, za: { lat: 3, lng: 4 } }, links: { 'zb|za': { rideMin: 9 }, 'za|zb': { rideMin: 8 } } },
    pois: ids.map((id) => raw(id, over[id])),
    walk: { pairs: { 'zeta|alpha': 3, 'alpha|zeta': 4, 'mid|beta': 5 } },
    trip: { id: tripId, name: `旅程 ${tripId}`, days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: 'mid', priority: 'want' }] }] },
    rulesJson: { settings: { zzz: 1, aaa: 2 }, rules: { 'b-rule': { weight: 1 }, 'a-rule': { weight: 2 } } },
    generatedAt: at,
  });
}
const idsOf = (r) => r.pois.map((p) => p.id);
/** 上一版 App（11-24 上線的那一版）存的樣子：POI 一筆一筆、旅程那一筆沒有 poiOrder。 */
function putOldShape(pack) {
  const { pois } = readPack(pack);
  for (const p of pois) idb.put(DB_NAME, 'pois', { ...p, cityId: pack.city.id });
  idb.put(DB_NAME, 'trips', { ...pack.trip, cityId: pack.city.id, country: pack.country, zones: pack.zones, walk: pack.walk, rules: pack.rules, packMeta: pack.meta, city: pack.city });
}

test('匯入 → 讀回：POI 照打包檔的先後（不是 id 的排序）、每一筆都在；區、連結、步行矩陣、國家層、規則、旅程原樣（鍵的先後也一樣）', async () => {
  assert.equal(await store.loadLatestPack(), null, '還沒有旅程');
  const pack = packOf();
  assert.notDeepEqual(ORDER, sortedIds(ORDER), '夾具：打包檔的先後跟 id 的排序不同');
  const r = await store.importPack(pack);
  assert.deepEqual([r.tripId, r.poiCount], ['t1', 6]);
  assert.deepEqual(idb.rows(DB_NAME, 'pois').map((p) => p.id), sortedIds(ORDER), '資料庫裡整批讀出來是 id 的排序（真的 IndexedDB 也是）');
  const back = await store.loadLatestPack();
  assert.deepEqual(idsOf(back), ORDER, '讀回來照打包檔的先後');
  assert.deepEqual(back.pois, readPack(pack).pois.map((p) => ({ ...p, cityId: 'c' })), '每一筆的內容就是規範化之後存進去的那一筆（多一個 cityId）');
  for (const key of ['zones', 'walk', 'country', 'rules', 'city', 'trip']) assert.equal(JSON.stringify(back.pack[key]), JSON.stringify(pack[key]), `${key} 原樣（含鍵的先後）`);
  assert.deepEqual(back.pack.meta, pack.meta);
  assert.deepEqual(Object.keys(back.pack.trip), Object.keys(pack.trip), '旅程物件上沒有多出資料層自己的欄位（poiOrder、cityId…）');
  assert.deepEqual(await store.loadPack('t1'), back, '指定旅程讀回來是同一份');
  assert.equal(await store.loadPack('沒有這一趟'), null);
});

test('舊資料（上一版 App 存的，旅程那一筆沒有記先後）：讀得進來，順序照舊（id 的排序）、同城的每一筆都給——等他下次按「更新」才換成打包檔的先後', async () => {
  idb.clear();
  const pack = packOf();
  putOldShape(pack);
  const back = await store.loadLatestPack();
  assert.deepEqual(idsOf(back), sortedIds(ORDER));
  assert.equal(JSON.stringify(back.pack.trip), JSON.stringify(pack.trip));
  // 再按一次「更新」（同一包）：從此照打包檔的先後
  await store.importPack(pack);
  assert.deepEqual(idsOf(await store.loadLatestPack()), ORDER);
});

test('手機裡留著舊包才有的店（10-27 的包有一筆、之後知識庫拿掉了；匯入只寫不刪）：按「更新」之後讀回來的就是新包那幾筆、照新包的先後，舊的那一筆不再跑進來', async () => {
  idb.clear();
  putOldShape(packOf({ ids: ['gone', ...ORDER], at: '2026-10-27T00:00:00.000Z' }));
  assert.ok(idsOf(await store.loadLatestPack()).includes('gone'), '更新之前：舊資料照舊');
  await store.importPack(packOf());
  assert.deepEqual(idsOf(await store.loadLatestPack()), ORDER, '更新之後：只有新包的六筆，先後照新包');
  assert.ok(idb.rows(DB_NAME, 'pois').some((p) => p.id === 'gone'), '舊的那一筆還在資料庫裡（不刪），只是不屬於這一包');
});

test('同一個城市的兩趟旅程：各自照自己那一包的名單與先後；loadLatestPack 給打包時間最新的那一趟，loadPack 給指定的那一趟', async () => {
  idb.clear();
  await store.importPack(packOf({ tripId: 'x', ids: ['c2', 'a2', 'b2'], at: '2026-11-01T00:00:00.000Z' }));
  await store.importPack(packOf({ tripId: 'y', ids: ['b2', 'd2', 'a2'], at: '2026-11-20T00:00:00.000Z', over: { a2: { name_zh: '新名字' } } }));
  assert.deepEqual([(await store.loadLatestPack()).pack.trip.id, idsOf(await store.loadLatestPack())], ['y', ['b2', 'd2', 'a2']]);
  const x = await store.loadPack('x');
  assert.deepEqual(idsOf(x), ['c2', 'a2', 'b2'], '比較舊的那一趟：自己的名單與先後');
  assert.equal(x.pois[1].name_zh, '新名字', '同一家店的內容是最後匯入的那一版（POI 照 id 存一筆，這一點照舊）');
  // 後來又匯入一包打包時間比較舊的第三趟：指定讀它就是它（畫面按完「更新」要顯示剛收的這一趟），最新的仍是 y
  await store.importPack(packOf({ tripId: 'w', ids: ['a2', 'c2'], at: '2026-10-01T00:00:00.000Z' }));
  assert.deepEqual([idsOf(await store.loadPack('w')), (await store.loadLatestPack()).pack.trip.id], [['a2', 'c2'], 'y']);
  // 手組的包同一個 id 寫了兩次：表裡只存得下一筆，讀回來也只有一筆、在第一次出現的位置
  await store.importPack(packOf({ tripId: 'dup', ids: ['b2', 'a2', 'b2'], at: '2026-09-01T00:00:00.000Z' }));
  assert.deepEqual(idsOf(await store.loadPack('dup')), ['b2', 'a2']);
});

test('packFromStore（純函式）：名單上有、資料庫裡沒有的 id 跳過；沒有名單或名單不是陣列就原樣給', () => {
  const rec = { id: 't', name: 'n', days: [], cityId: 'c', city: { id: 'c' }, country: null, zones: {}, walk: {}, rules: null, packMeta: { generatedAt: 'x' } };
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(packFromStore({ ...rec, poiOrder: ['c', 'zz', 'a'] }, rows).pois, [{ id: 'c' }, { id: 'a' }]);
  assert.deepEqual(packFromStore(rec, rows).pois, rows);
  assert.deepEqual(packFromStore({ ...rec, poiOrder: 'abc' }, rows).pois, rows);
  assert.deepEqual(packFromStore({ ...rec, poiOrder: [] }, rows).pois, [], '空名單就是空的（這一包真的沒有 POI）');
  const { pack } = packFromStore({ ...rec, poiOrder: ['a'], city: undefined }, rows);
  assert.deepEqual([pack.trip, pack.city, pack.meta], [{ id: 't', name: 'n', days: [] }, { id: 'c' }, { generatedAt: 'x' }]);
});
