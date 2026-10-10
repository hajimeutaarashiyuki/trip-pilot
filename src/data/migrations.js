// IndexedDB 版本階梯（決策樹 Q3 之後的資料層原則、研究報告 §五）：
// 只加 store／index 不刪；每一階只在 oldVersion < N 時跑；資料轉換放在升級交易內，任一步失敗整個回滾。
// 這裡只放「純函式」的階梯，讓 Node 測試用假的 db 物件驗證；真正的 openDB 在 store.js。

export const DB_NAME = 'trip-pilot';
export const DB_VERSION = 1;

/** 每一階：{ version, apply(db, tx) }。apply 只能呼叫 createObjectStore／createIndex／transaction 內的讀寫。 */
export const MIGRATIONS = [
  {
    version: 1,
    note: '初版：知識庫 POI、旅程、裝置（同步端點與 token，不進任何匯出）、備份快照',
    apply(db) {
      const pois = db.createObjectStore('pois', { keyPath: 'id' });
      pois.createIndex('byCity', 'cityId', { unique: false });
      pois.createIndex('byCategory', 'category', { unique: false });
      db.createObjectStore('trips', { keyPath: 'id' });
      db.createObjectStore('device', { keyPath: 'key' });
      const backups = db.createObjectStore('backups', { keyPath: 'at' });
      backups.createIndex('byTrip', 'tripId', { unique: false });
    },
  },
];

/** 從 oldVersion 升到 newVersion：只跑 oldVersion < m.version ≤ newVersion 的階。回傳跑過的版本號。 */
export function runMigrations(db, oldVersion, newVersion = DB_VERSION, migrations = MIGRATIONS) {
  const ran = [];
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of sorted) {
    if (m.version > oldVersion && m.version <= newVersion) {
      m.apply(db);
      ran.push(m.version);
    }
  }
  return ran;
}
