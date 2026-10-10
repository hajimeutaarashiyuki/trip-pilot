// 畫面的「天黑 HH:MM 前」：白天站才有；位置用站的座標或區心；位置或時區沒有就不顯示（null，不猜時區）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { darkBeforeMin, darkBeforeMinOf } from '../../src/ui/daylight.js';

const SENDAI = { lat: 38.2688, lng: 140.8721 };
const near = (actual, hm, tol = 2) => { const [h, m] = hm.split(':').map(Number); assert.ok(Math.abs(actual - (h * 60 + m)) <= tol, `${actual} 分離 ${hm} 超過 ${tol} 分`); };

test('仙台 8/13 日落 18:33（NOAA 年表），扣 30 分 → 18:03；整數分', () => {
  const v = darkBeforeMin({ daylightOnly: true, ...SENDAI }, '2026-08-13', { marginMin: 30, utcOffsetMin: 540 });
  near(v, '18:03');
  assert.equal(v, Math.floor(v));
});

test('站沒座標就用該區區心；區也沒座標回 null；不是白天站回 null', () => {
  const zones = { hachiman: { lat: 38.2716, lng: 140.8449 }, nowhere: {} };
  near(darkBeforeMin({ daylightOnly: true, zoneId: 'hachiman' }, '2026-08-13', { zones, marginMin: 30, utcOffsetMin: 540 }), '18:03');
  assert.equal(darkBeforeMin({ daylightOnly: true, zoneId: 'nowhere' }, '2026-08-13', { zones, utcOffsetMin: 540 }), null);
  assert.equal(darkBeforeMin({ daylightOnly: true }, '2026-08-13', { zones, utcOffsetMin: 540 }), null);
  assert.equal(darkBeforeMin({ daylightOnly: false, ...SENDAI }, '2026-08-13', { utcOffsetMin: 540 }), null);
});

test('沒有時區就不顯示（null），不當日本；darkBeforeMinOf 從 App 狀態取區、margin、時區，margin 缺用 30', () => {
  assert.equal(darkBeforeMin({ daylightOnly: true, ...SENDAI }, '2026-08-13', { marginMin: 30 }), null);
  assert.equal(darkBeforeMinOf({ daylightOnly: true, ...SENDAI }, '2026-08-13', {}), null);
  assert.equal(darkBeforeMinOf({ daylightOnly: true, ...SENDAI }, '2026-08-13', { country: {} }), null);
  const state = { kb: { zones: { hachiman: { lat: 38.2716, lng: 140.8449 } } }, settings: { daylightMarginMin: 60 }, country: { utcOffsetMin: 540 } };
  near(darkBeforeMinOf({ daylightOnly: true, zoneId: 'hachiman' }, '2026-08-13', state), '17:33');
  near(darkBeforeMinOf({ daylightOnly: true, ...SENDAI }, '2026-08-13', { country: { utcOffsetMin: 540 } }), '18:03');
});
