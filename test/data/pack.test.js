// 打包檔：建、讀、驗格式、比新舊。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPack, readPack, isNewer, PACK_FORMAT } from '../../src/data/pack.js';

const city = { id: 'sendai', name: '仙台' };
const trip = { id: 't-2026-08', days: [] };
const pois = [{ name_zh: 'Utah', category: '古著店', duration: '60 分鐘' }, { name_zh: '瑞鳳殿', category: '靈廟' }];
const JP = fileURLToPath(new URL('../../../kb/country/jp.json', import.meta.url));   // 私人倉庫的國家層；沒有就跳過那段

test('readPack 帶 pack.country（T20）：要準備的恢復站型從國家層 recoveryTypes 帶 prepNeeded；沒國家層不帶；真的 jp.json 錢湯帶毛巾、換洗衣物、免稅緩衝 45', async () => {
  const sento = { name_zh: '駒の湯', category: '錢湯' };
  const at = '2026-10-16T00:00:00Z';
  const withCountry = readPack(JSON.stringify(buildPack({ city, trip, pois: [sento], country: { recoveryTypes: [{ category: 'onsen', prepNeeded: ['毛巾', '換洗衣物'] }] }, generatedAt: at })));
  assert.deepEqual(withCountry.pois[0].prepNeeded, ['毛巾', '換洗衣物']);
  const without = readPack(JSON.stringify(buildPack({ city, trip, pois: [sento], generatedAt: at })));
  assert.equal(without.pack.country, null);
  assert.equal(without.pois[0].prepNeeded, undefined);
  if (!existsSync(JP)) return;
  const jp = JSON.parse(await readFile(JP, 'utf8'));
  const real = readPack(JSON.stringify(buildPack({ city, trip, pois: [sento], country: jp, generatedAt: at })));
  assert.deepEqual(real.pois[0].prepNeeded, ['毛巾', '換洗衣物']);
  assert.equal(real.pack.country.taxRefund.bufferMin, 45);
  assert.equal(real.pack.country.taxRefund.effectiveFrom, '2026-11-01');
  assert.equal(real.pack.country.transportProfile.nightWalk.risk, 'low');
  assert.deepEqual(real.pack.country.themes.map((t) => t.id), ['sakura', 'momiji', 'snow', 'matsuri', 'hanabi']);
});

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
