// 打包檔：建、讀、驗格式、比新舊。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, readPack, isNewer, PACK_FORMAT } from '../../src/data/pack.js';

const city = { id: 'sendai', name: '仙台' };
const trip = { id: 't-2026-08', days: [] };
const pois = [{ name_zh: 'Utah', category: '古著店', duration: '60 分鐘' }, { name_zh: '瑞鳳殿', category: '靈廟' }];

test('buildPack 帶 meta；readPack 會 normalize 每個 POI 並回警告', () => {
  const pack = buildPack({ city, trip, pois, generatedAt: '2026-10-10T12:00:00Z' });
  assert.equal(pack.meta.format, PACK_FORMAT);
  assert.equal(pack.meta.poiCount, 2);
  const r = readPack(JSON.stringify(pack));
  assert.equal(r.pois[0].category, 'vintage');
  assert.equal(r.pois[0].walkFactor, 0);
  assert.ok(r.warnings.some((w) => w.code === 'coords-missing'));
});

test('不是打包檔、版本太新、缺旅程都明確丟錯', () => {
  assert.throws(() => readPack({ meta: { format: 'x' } }), /不是 Trip Pilot/);
  assert.throws(() => readPack({ meta: { format: PACK_FORMAT, version: 99 }, trip, city }), /比 App 新/);
  assert.throws(() => readPack({ meta: { format: PACK_FORMAT, version: 1 }, city }), /缺旅程/);
  assert.throws(() => buildPack({ city, trip: {}, pois }), /trip\.id/);
});

test('isNewer 用 generatedAt 比', () => {
  const a = buildPack({ city, trip, pois, generatedAt: '2026-10-10T12:00:00Z' });
  const b = buildPack({ city, trip, pois, generatedAt: '2026-10-11T08:00:00Z' });
  assert.equal(isNewer(b, a), true);
  assert.equal(isNewer(a, b), false);
});
