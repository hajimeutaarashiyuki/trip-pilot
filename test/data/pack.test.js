// 打包檔：建、讀、驗格式、比新舊。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPack, readPack, isNewer, PACK_FORMAT, PACK_VERSION } from '../../src/data/pack.js';

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

test('打包檔的版本（11-17 升到 2）：新打的包標 2；版本 1（10-27 以前的舊包）與沒寫版本的照樣讀得進；版本 2 讀得進；版本 3 丟「打包檔版本 3 比 App 新，先更新 App」', async () => {
  // 為什麼升：11-06 第二批起的包帶舊版 App 看不懂的東西（國家層的早餐段、分日別的末班、meals…），舊版讀到會露出「今天沒排breakfast」並每天扣分（11-12 審查實測）。
  // 舊版 App 的 readPack 就是下面這道門、PACK_VERSION 是 1：新包標成 2，它就拒收、叫他先更新 App
  assert.equal(PACK_VERSION, 2);
  const fresh = buildPack({ city, trip, pois, generatedAt: '2026-11-17T00:00:00Z' });
  assert.equal(fresh.meta.version, 2, '新打的包標成版本 2');
  const as = (version) => ({ ...fresh, meta: { ...fresh.meta, version } });
  for (const v of [1, 2]) {
    const r = readPack(JSON.stringify(as(v)));
    assert.equal(r.pack.meta.version, v);
    assert.equal(r.pois.length, 2, `版本 ${v} 讀得進`);
  }
  const { version: _gone, ...noVersion } = fresh.meta;
  assert.equal(readPack({ ...fresh, meta: noVersion }).pois.length, 2, '沒寫版本的（手組的包）當舊的收');
  assert.throws(() => readPack(JSON.stringify(as(3))), { message: '打包檔版本 3 比 App 新，先更新 App' });
  // 舊版 App（PACK_VERSION 還是 1 的那一版）遇到新包走的是同一道門：同一句話、數字是 2
  const oldAppGate = (pack) => { if (pack.meta.version > 1) throw new Error(`打包檔版本 ${pack.meta.version} 比 App 新，先更新 App`); };
  assert.throws(() => oldAppGate(fresh), { message: '打包檔版本 2 比 App 新，先更新 App' });
  assert.doesNotThrow(() => oldAppGate(as(1)));
  // 真的舊包（私人倉庫 packs/ 的 10-27 三包，版本 1；沒有、或之後重打過就跳過）：新版照樣讀得進，沒有早餐段
  for (const name of ['pack.json', '2026-08-sendai-business.json', '2026-08-sendai-trial.json']) {
    const file = fileURLToPath(new URL(`../../../packs/${name}`, import.meta.url));
    if (!existsSync(file)) continue;
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.meta?.version !== 1) continue;
    const r = readPack(raw);
    assert.equal(r.pois.length, raw.meta.poiCount, `${name}：版本 1 的舊包讀得進`);
    assert.equal(r.pack.country?.mealSlots?.breakfast, undefined, `${name}：舊包沒有早餐段`);
  }
});

test('isNewer 用 generatedAt 比', () => {
  const a = buildPack({ city, trip, pois, generatedAt: '2026-10-10T12:00:00Z' });
  const b = buildPack({ city, trip, pois, generatedAt: '2026-10-11T08:00:00Z' });
  assert.equal(isNewer(b, a), true);
  assert.equal(isNewer(a, b), false);
});
