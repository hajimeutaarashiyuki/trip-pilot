// 城市設定：city.json 一份管一城。缺檔要明確報錯（不退回仙台的值）；bbox 缺就由 center ± bboxKm 推；欄位錯要說哪一欄。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCity, parseCity, bboxAround, inBbox, valhallaUrl, valhallaHint, DEFAULT_BBOX_KM } from '../../tools/lib/city.mjs';

const FAKECITY = fileURLToPath(new URL('../fixtures/kb/fakecity/', import.meta.url));

test('loadCity：沒有 city.json 就丟錯說要先建', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'tp-nocity-'));
  assert.throws(() => loadCity(empty), /city\.json 不存在：先建/);
});

test('loadCity：假城市的 bbox 由 center ± bboxKm 推，中心在框內；Valhalla 網址與提示用 city.json 的埠與區域', () => {
  const city = loadCity(FAKECITY);
  assert.equal(city.id, 'fakecity');
  assert.equal(city.name_local, '偽町');
  assert.equal(city.countryId, 'jp');
  assert.equal(city.bboxDerived, true);
  assert.ok(inBbox(city.center, city.bbox));
  // 3 km：緯度差 2×3/111 ≈ 0.054 度；經度照 cos(緯度) 放大
  assert.ok(Math.abs((city.bbox.north - city.bbox.south) - 6 / 111) < 1e-3);
  assert.ok(city.bbox.east - city.bbox.west > city.bbox.north - city.bbox.south);
  assert.equal(valhallaUrl(city), 'http://127.0.0.1:8099');
  assert.match(valhallaHint(city), /asia\/japan\/kansai.*8099/);
});

test('parseCity：明寫的 bbox 照收；錯的欄位說哪一欄；容器名缺就用 region 最後一段', () => {
  const base = { id: 'x', name_zh: 'X', countryId: 'jp', center: { lat: 10, lng: 20 } };
  const c = parseCity({ ...base, bbox: { west: 19, south: 9, east: 21, north: 11 } });
  assert.equal(c.bboxDerived, false);
  assert.deepEqual(c.bbox, { west: 19, south: 9, east: 21, north: 11 });
  assert.equal(c.name_local, 'X', 'name_local 缺就用 name_zh');
  assert.equal(c.valhalla, null);
  assert.equal(valhallaUrl(c), null);
  assert.match(valhallaHint(c), /city\.json 沒寫 valhalla/);
  assert.throws(() => parseCity({ ...base, id: undefined }), /缺 id/);
  assert.throws(() => parseCity({ ...base, countryId: '' }), /缺 countryId/);
  assert.throws(() => parseCity({ ...base, center: { lat: 'a' } }), /center/);
  assert.throws(() => parseCity({ ...base, bbox: { west: 21, south: 9, east: 19, north: 11 } }), /west 要小於 east/);
  assert.throws(() => parseCity({ ...base, bbox: { west: 30, south: 9, east: 31, north: 11 } }), /center 不在 bbox/);
  assert.throws(() => parseCity({ ...base, bboxKm: -1 }), /bboxKm/);
  assert.throws(() => parseCity({ ...base, valhalla: { region: 'asia/taiwan', port: 'x' } }), /valhalla\.port/);
  assert.throws(() => parseCity({ ...base, valhalla: { port: 8003 } }), /valhalla\.region/);
  assert.equal(parseCity({ ...base, valhalla: { region: 'asia/taiwan', port: 8003 } }).valhalla.container, 'valhalla-taiwan');
});

test('bboxAround：預設 30 km，南北對稱、東西對稱；inBbox 沒框就不擋', () => {
  const b = bboxAround({ lat: 0, lng: 0 });
  assert.ok(Math.abs(b.north - DEFAULT_BBOX_KM / 111) < 1e-4);
  assert.ok(Math.abs(b.north + b.south) < 1e-9);
  assert.ok(Math.abs(b.east + b.west) < 1e-9);
  assert.equal(inBbox({ lat: 50, lng: 50 }, b), false);
  assert.equal(inBbox({ lat: 50, lng: 50 }, null), true);
});
