// 版本階梯：只跑該跑的階、只加不刪；用假的 db 物件驗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, MIGRATIONS, DB_VERSION } from '../../src/data/migrations.js';

function fakeDb() {
  const stores = new Map();
  return {
    stores,
    createObjectStore(name, opts) {
      if (stores.has(name)) throw new Error(`store 已存在：${name}`);
      const indexes = new Map();
      const store = { opts, indexes, createIndex: (n, key, o) => indexes.set(n, { key, o }) };
      stores.set(name, store);
      return store;
    },
  };
}

test('從 0 升到最新：四個 store、兩個索引，階梯照版本遞增', () => {
  const db = fakeDb();
  const ran = runMigrations(db, 0);
  assert.deepEqual(ran, MIGRATIONS.map((m) => m.version));
  assert.deepEqual([...db.stores.keys()].sort(), ['backups', 'device', 'pois', 'trips']);
  assert.ok(db.stores.get('pois').indexes.has('byCity'));
  assert.ok(db.stores.get('backups').indexes.has('byTrip'));
});

test('已是最新版就什麼都不跑；版本號遞增且不重複', () => {
  assert.deepEqual(runMigrations(fakeDb(), DB_VERSION), []);
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...new Set(versions)].sort((a, b) => a - b));
  assert.equal(versions.at(-1), DB_VERSION);
});
