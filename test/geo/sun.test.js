// 日出日落（NOAA 公式，自己算、不接 API）：仙台兩個日期對照 NOAA Solar Calculator 年表（±2 分）；時窗兩頭各扣 margin；極夜極晝不炸。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, daylightWindow } from '../../src/geo/sun.js';

const SENDAI = { lat: 38.2688, lng: 140.8721 };
const near = (actual, hm, tol = 2) => { const [h, m] = hm.split(':').map(Number); assert.ok(Math.abs(actual - (h * 60 + m)) <= tol, `${Math.round(actual)} 分離 ${hm} 超過 ${tol} 分`); };

test('仙台 8/13 日出 04:49、日落 18:33；12/21 06:49／16:19（NOAA 年表，JST，±2 分）', () => {
  const summer = sunTimes('2026-08-13', SENDAI.lat, SENDAI.lng, 540);
  near(summer.sunriseMin, '04:49'); near(summer.sunsetMin, '18:33');
  const winter = sunTimes('2026-12-21', SENDAI.lat, SENDAI.lng, 540);
  near(winter.sunriseMin, '06:49'); near(winter.sunsetMin, '16:19');
});

test('daylightWindow 兩頭各扣 margin；時區只是平移', () => {
  const s = sunTimes('2026-08-13', SENDAI.lat, SENDAI.lng, 540);
  const w = daylightWindow('2026-08-13', SENDAI, 30, 540);
  assert.equal(w.startMin, s.sunriseMin + 30);
  assert.equal(w.endMin, s.sunsetMin - 30);
  const utc = sunTimes('2026-08-13', SENDAI.lat, SENDAI.lng, 0);
  assert.ok(Math.abs((s.sunriseMin - utc.sunriseMin) - 540) < 1);
});

test('極夜回沒有白天（日出＝日落）、極晝回整天，都不丟例外', () => {
  const night = sunTimes('2026-12-21', 78.2, 15.6, 60);
  assert.equal(night.sunriseMin, night.sunsetMin);
  const day = sunTimes('2026-06-21', 78.2, 15.6, 60);
  assert.ok(day.sunsetMin - day.sunriseMin >= 1439);
});
