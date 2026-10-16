// 走廊清單的幾何（T15）：點到線段的距離（經緯度換公尺）——垂足在線段內取垂直距離、在線段外取到最近端點的距離、線段退化成一點就是兩點距離；缺座標回 Infinity。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distToSegmentM } from '../../src/geo/corridor.js';
import { haversineM } from '../../src/geo/matrix.js';

const A = { lat: 38.26, lng: 140.87 }; const B = { lat: 38.26, lng: 140.88 };   // 東西向、約 875 m

test('垂足在線段內：離線 0.0005° 緯度 ≈ 55.6 m（1° 緯度 ≈ 111,195 m）；在線上是 0', () => {
  const d = distToSegmentM({ lat: 38.2605, lng: 140.875 }, A, B);
  assert.ok(Math.abs(d - 55.6) < 1, `${d}`);
  assert.ok(distToSegmentM({ lat: 38.26, lng: 140.875 }, A, B) < 0.01);
  assert.ok(Math.abs(distToSegmentM({ lat: 38.2591, lng: 140.8712 }, A, B) - 100.1) < 1, '線的另一側、靠近端點也是垂直距離');
});

test('垂足在線段外：距離是到最近端點的直線距離（跟 haversine 差 < 1%），不是到延長線的距離', () => {
  const P = { lat: 38.261, lng: 140.885 };
  const d = distToSegmentM(P, A, B); const h = haversineM(P, B);
  assert.ok(Math.abs(d - h) / h < 0.01, `${d} vs ${h}`);
  assert.ok(d > 400, '到延長線只有 111 m，到端點 B 要 450 m 左右');
  const Q = { lat: 38.26, lng: 140.865 };
  assert.ok(Math.abs(distToSegmentM(Q, A, B) - haversineM(Q, A)) < 1, '另一頭：到端點 A');
});

test('線段退化成一點＝兩點距離；缺座標回 Infinity；a、b 對調結果一樣', () => {
  const P = { lat: 38.2605, lng: 140.875 };
  assert.ok(Math.abs(distToSegmentM(P, A, A) - haversineM(P, A)) < 1);
  assert.equal(distToSegmentM({ lat: null, lng: null }, A, B), Infinity);
  assert.equal(distToSegmentM(P, { id: 'home' }, B), Infinity, '住宿沒座標');
  assert.equal(distToSegmentM(P, A, null), Infinity);
  assert.ok(Math.abs(distToSegmentM(P, A, B) - distToSegmentM(P, B, A)) < 1e-6);
});
