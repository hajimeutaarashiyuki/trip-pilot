// 走廊清單的幾何（T15，DESIGN §1.9「走廊清單不是站」）：一家店離「這段移動的直線」幾公尺＝點到線段的距離。
// 經緯度先以線段中點的緯度做等距圓柱投影換成公尺（幾百公尺的尺度誤差不到 1 m），再算平面上點到線段的距離；線段退化成一點就是兩點的 haversine。
import { haversineM } from './matrix.js';

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/** 點 p 到線段 a–b 的距離（公尺）。三個點都要有 lat／lng，缺了回 Infinity（半徑篩不會收、排序自然排最後）；a、b 對調結果一樣。 */
export function distToSegmentM(p, a, b) {
  if (!hasCoords(p) || !hasCoords(a) || !hasCoords(b)) return Infinity;
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  const x = (q) => toRad(q.lng) * k * R;
  const y = (q) => toRad(q.lat) * R;
  const ax = x(a); const ay = y(a); const bx = x(b); const by = y(b); const px = x(p); const py = y(p);
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return haversineM(p, a);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
