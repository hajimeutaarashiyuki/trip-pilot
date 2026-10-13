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

test('沒有直達連結就轉乘一次（取總分鐘最少），只有比走路快才搭；連轉乘都沒有照走', () => {
  const links = { 'ichibancho|hub': { mode: 'subway', rideMin: 8, walkMin: 5 }, 'hub|north': { mode: 'jr', rideMin: 28, walkMin: 5 }, 'hachiman|hub': { mode: 'bus', rideMin: 40, walkMin: 5 } };
  const N = { id: 'n', name_zh: 'N', zoneId: 'north', lat: 38.33, lng: 141.02 };
  const legFn = makeLegFn({ walk: { 'a|n': { min: 203, m: 16000 }, 'c|n': { min: 50, m: 4000 } }, settings, zoneLinks: links });
  assert.deepEqual(legFn(A, N), { walkMin: 10, rideMin: 36, climbMin: 0, mode: 'ride', source: 'link', via: 'hub' }, '一番町→北：經 hub 轉乘 8+28、走 5+5，不走 203 分');
  assert.equal(legFn(C, N).mode, 'walk', '八幡→北：轉乘要 40+28+10 比走 50 慢，照走');
  const none = makeLegFn({ walk: { 'a|n': { min: 203, m: 16000 } }, settings, zoneLinks: { 'hub|north': { mode: 'jr', rideMin: 28, walkMin: 5 } } });
  assert.equal(none(A, N).mode, 'walk', '一番町連到 hub 的連結都沒有：照走');
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
