// IndexedDB 讀寫層（手機是真相，DESIGN §3.2）。形狀借 case-lab 的 store.js：
//   - openDB 只在 onupgradeneeded 跑 migrations.js 的階梯
//   - tx(mode, store, fn) 在交易 oncomplete 才 resolve，並把 IDBRequest 的結果拆出來（get 找不到要回 undefined）
//   - 存了就廣播一聲給其他分頁
// 這一層只在瀏覽器跑；Node 測試測的是 migrations 與 pack 的純函式，收包與讀回（importPack、loadPack、loadLatestPack）另用假的 IndexedDB 跑（test/_idb.js；11-24）。
import { DB_NAME, DB_VERSION, runMigrations } from './migrations.js';
import { readPack, packFromStore } from './pack.js';

let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => { runMigrations(req.result, e.oldVersion, e.newVersion ?? DB_VERSION); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('資料庫被另一個分頁擋住，關掉其他 Trip Pilot 分頁再試'));
  });
  return dbPromise;
}

export async function tx(mode, storeNames, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = (Array.isArray(storeNames) ? storeNames : [storeNames]).map((n) => t.objectStore(n));
    let result;
    try { result = fn(...stores); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

let channel;
function announce(msg) {
  try {
    if (channel === undefined) channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('trip-pilot') : null;
    channel?.postMessage(msg);
  } catch { /* 分頁正在關 */ }
}

export const getTrip = (id) => tx('readonly', 'trips', (s) => s.get(id));
export const listTrips = () => tx('readonly', 'trips', (s) => s.getAll());
export async function putTrip(trip) {
  await tx('readwrite', 'trips', (s) => s.put(JSON.parse(JSON.stringify(trip))));
  announce({ type: 'trip', id: trip.id, updatedAt: trip.updatedAt ?? null });
}
export const getPoi = (id) => tx('readonly', 'pois', (s) => s.get(id));
export const listPoisByCity = (cityId) => tx('readonly', 'pois', (s) => s.index('byCity').getAll(cityId));
export const getDevice = (key) => tx('readonly', 'device', (s) => s.get(key));
export const putDevice = (key, value) => tx('readwrite', 'device', (s) => s.put({ key, ...value }));

/**
 * 收打包檔：POI 整批寫進 pois（帶 cityId），旅程寫進 trips，矩陣與國家層存在 trips 的旅程物件裡（跟旅程一起離線）。
 * 旅程那一筆另記 poiOrder＝這一包每筆 POI 的 id、照打包檔的先後：讀回來照它排、只拿名單上的（data/pack.js packFromStore；11-24）。只寫不刪：別包才有的 POI 留在表裡。
 * 同一個 id 在打包檔裡出現兩次（手組的包；tools/pack.mjs 打的不會）名單只記一次、照第一次出現的位置——表裡本來就只存得下一筆。
 * 回 { tripId, poiCount, warnings }。
 */
export async function importPack(json) {
  const { pack, pois, warnings } = readPack(json);
  const cityId = pack.city.id;
  await tx('readwrite', ['pois', 'trips'], (poiStore, tripStore) => {
    for (const p of pois) poiStore.put({ ...p, cityId });
    tripStore.put({ ...pack.trip, cityId, country: pack.country, zones: pack.zones, walk: pack.walk, rules: pack.rules, packMeta: pack.meta, city: pack.city, poiOrder: [...new Set(pois.map((p) => p.id))] });
  });
  announce({ type: 'pack', tripId: pack.trip.id });
  return { tripId: pack.trip.id, poiCount: pois.length, warnings };
}

/** 備份快照：整個旅程物件（含實錄）存一筆，給桌機接收用；也是手機端「能離開 App 讀」的格式。 */
export async function snapshotTrip(tripId) {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error('沒有這個旅程');
  const at = new Date().toISOString();
  await tx('readwrite', 'backups', (s) => s.put({ at, tripId, trip }));
  return { at, trip };
}

/**
 * 手機裡最新的旅程（打包時間最新那趟）還原成 loadFromPack 要的 { pack, pois }；沒有回 null。開 App 時走這裡（ui/app.js boot）。
 * POI 的先後與名單照那一包（packFromStore）；上一版 App 存的資料沒有名單，照舊給同城的每一筆、id 的排序。
 */
export async function loadLatestPack() {
  const trips = await listTrips();
  if (!trips?.length) return null;
  const t = [...trips].sort((a, b) => String(b.packMeta?.generatedAt ?? '').localeCompare(String(a.packMeta?.generatedAt ?? '')))[0];
  return packFromStore(t, await listPoisByCity(t.cityId));
}

/**
 * 手機裡指定的那一趟（旅程 id）還原成 loadFromPack 要的 { pack, pois }；沒有回 null。按完「更新」走這裡（ui/app.js applyPackJson）：
 * 剛收的那一包存進去之後從這裡讀回來再載入——跟重開頁面是同一條讀取的路，記憶體裡的資料才會逐筆相同（收的那一趟不一定是打包時間最新的，所以指定 id）。
 */
export async function loadPack(tripId) {
  const t = await getTrip(tripId);
  return t ? packFromStore(t, await listPoisByCity(t.cityId)) : null;
}
