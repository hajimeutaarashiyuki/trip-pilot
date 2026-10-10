// T5：站對站移動的查法——先 walk.json，再直線距離估（記警告），再跨區連結，最後區域預設。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLegFn, haversineM } from '../../src/geo/matrix.js';

const A = { id: 'a', name_zh: 'A', zoneId: 'ichibancho', lat: 38.2600, lng: 140.8710 };
const B = { id: 'b', name_zh: 'B', zoneId: 'ichibancho', lat: 38.2650, lng: 140.8750 };
const C = { id: 'c', name_zh: 'C', zoneId: 'hachiman', lat: 38.2740, lng: 140.8480 };
const D = { id: 'd', name_zh: 'D', zoneId: 'hachiman' };   // 沒座標
const settings = { walkingMPerMin: 80, detourFactor: 1.3, walkVsRideMaxWalkMin: 30 };
const zoneLinks = { 'ichibancho|hachiman': { mode: 'bus', rideMin: 15, walkMin: 5 } };

test('walk.json 有就用它；沒有就直線距離 ×1.3 ÷ 80 並記一次警告', () => {
  const legFn = makeLegFn({ walk: { 'a|b': { min: 9, m: 700 } }, settings, zoneLinks });
  assert.deepEqual(legFn(A, B), { walkMin: 9, rideMin: 0, climbMin: 0, mode: 'walk', source: 'valhalla', m: 700 });
  const est = legFn(B, A);
  assert.equal(est.source, 'haversine');
  assert.equal(est.walkMin, Math.ceil((haversineM(A, B) * 1.3) / 80));
  legFn(B, A);
  assert.equal(legFn.warnings.length, 1, '同一段只警告一次');
});

test('走路太遠又有跨區連結就改搭車；沒座標的用連結或區域預設', () => {
  const legFn = makeLegFn({ walk: { 'a|c': { min: 45, m: 3600 } }, settings, zoneLinks });
  assert.equal(legFn(A, C).mode, 'ride');
  assert.equal(legFn(A, C).rideMin, 15);
  assert.deepEqual(legFn(A, D), { walkMin: 5, rideMin: 15, climbMin: 0, mode: 'ride', source: 'link' });
  const noLink = makeLegFn({ settings, fallbackMin: { sameZone: 8, crossZone: 25 } });
  assert.equal(noLink(D, { id: 'e', zoneId: 'hachiman' }).walkMin, 8);
  assert.equal(noLink(D, { id: 'f', zoneId: 'station' }).walkMin, 25);
});
