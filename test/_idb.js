// 測試共用的假 IndexedDB（不是測試檔）：只做 src/data/store.js 用到的那幾樣，資料放記憶體。test/data/store.test.js 與 test/ui/pack-order.test.js 用。
// 跟真的一樣的地方（測的就是這幾件事）：
// - put／get 都過一次 structuredClone（存進去的與讀回來的不是同一個物件）；
// - getAll() 照主鍵排、index(名).getAll(值) 篩出索引欄位等於那個值的、也照主鍵排——字串鍵照 UTF-16 碼元比（就是 JS 的 <），
//   所以「讀回來的 POI 是 id 的順序、不是存進去的順序」在這裡重現得出來（11-24 對抗審查第 1 項）；
// - 交易在呼叫端同步跑完之後才 oncomplete；request 是 IDBRequest 的實例（store.js 的 tx 用 instanceof 拆結果）。
// 沒做的：游標、keyRange、多欄位索引、版本衝突、交易中止。真瀏覽器的行為另外用 headless Chrome 量。
// 用法：const idb = installIdb()（在 import src/data/store.js 之前；store.js 把開好的資料庫記在模組裡）。idb.rows(庫, 表) 直接看存了什麼、idb.put(庫, 表, 值) 直接塞一筆（做舊版 App 存的資料）。

class FakeRequest {
  constructor(result) { this.result = result; this.error = null; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; this.onblocked = null; }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class FakeStore {
  constructor({ keyPath }) { this.keyPath = keyPath; this.data = new Map(); this.indexes = new Map(); }
  createIndex(name, keyPath) { this.indexes.set(name, keyPath); return {}; }
  put(value) { const v = structuredClone(value); this.data.set(v[this.keyPath], v); return new FakeRequest(v[this.keyPath]); }
  get(key) { return new FakeRequest(this.data.has(key) ? structuredClone(this.data.get(key)) : undefined); }
  sorted(keep = () => true) { return [...this.data.entries()].filter(([, v]) => keep(v)).sort(([a], [b]) => cmp(a, b)).map(([, v]) => structuredClone(v)); }
  getAll() { return new FakeRequest(this.sorted()); }
  index(name) {
    if (!this.indexes.has(name)) throw new Error(`沒有這個索引：${name}`);
    const field = this.indexes.get(name);
    return { getAll: (key) => new FakeRequest(this.sorted((v) => key === undefined || v[field] === key)) };
  }
}

/** 裝上假的 indexedDB、IDBRequest 與 BroadcastChannel（已經有就換成全新、空的一份）。回 { rows, put, clear, names, posted }。 */
export function installIdb() {
  const dbs = new Map();   // 庫名 → { version, stores: Map<表名, FakeStore> }
  const handle = (db) => ({
    createObjectStore(name, opts = {}) {
      if (db.stores.has(name)) throw new Error(`store 已存在：${name}`);
      const s = new FakeStore(opts); db.stores.set(name, s); return s;
    },
    transaction(names) {
      const list = Array.isArray(names) ? names : [names];
      for (const n of list) if (!db.stores.has(n)) throw new Error(`沒有這個 store：${n}`);
      const t = { error: null, oncomplete: null, onerror: null, onabort: null, objectStore: (n) => db.stores.get(n) };
      setTimeout(() => t.oncomplete?.(), 0);
      return t;
    },
  });
  // store.js 存完會用 BroadcastChannel 廣播一聲。Node 自己有 BroadcastChannel，開了不關行程就不會結束（測試檔會卡住）：換成只記下來的假貨
  const posted = [];
  globalThis.BroadcastChannel = class { constructor(name) { this.name = name; } postMessage(msg) { posted.push(structuredClone(msg)); } close() {} };
  globalThis.IDBRequest = FakeRequest;
  globalThis.indexedDB = {
    open(name, version = 1) {
      const req = new FakeRequest(undefined);
      setTimeout(() => {
        const old = dbs.get(name);
        const db = old ?? { version: 0, stores: new Map() };
        if (!old) dbs.set(name, db);
        req.result = handle(db);
        if (db.version < version) { const oldVersion = db.version; db.version = version; req.onupgradeneeded?.({ oldVersion, newVersion: version }); }
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  const storeOf = (dbName, storeName) => dbs.get(dbName)?.stores.get(storeName) ?? null;
  return {
    /** 那張表現在存的每一筆（照主鍵排；複本）。資料庫還沒開過回空陣列。 */
    rows: (dbName, storeName) => storeOf(dbName, storeName)?.sorted() ?? [],
    /** 直接塞一筆（不經過 store.js）：做「上一版 App 存的資料」用。資料庫要先開過（先呼叫一次 store.js 的函式）。 */
    put: (dbName, storeName, value) => { (storeOf(dbName, storeName) ?? (() => { throw new Error(`還沒有 ${dbName}／${storeName}`); })()).put(value); },
    /** 每張表清空（表與索引留著）：同一個測試檔裡換下一個情境用。 */
    clear: () => { for (const db of dbs.values()) for (const s of db.stores.values()) s.data.clear(); },
    names: () => [...dbs.keys()],
    /** 廣播過的訊息（照先後）。 */
    posted,
  };
}
