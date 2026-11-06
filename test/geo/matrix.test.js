// T5：站對站移動的查法——先 walk.json，再直線距離估（記警告），再跨區連結，最後區域預設。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLegFn, haversineM, lastDepartMin } from '../../src/geo/matrix.js';

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

// ── 末班車（原話 #190；11-06）：zones.json 連結的 last { "<出發區 id>": "HH:MM" } ──
test('lastDepartMin：連結上某一區往另一端的末班發車時刻；沒寫、寫壞回 null；過了午夜的班次（04:00 前）算隔天', () => {
  const link = { mode: 'jr', rideMin: 38, walkMin: 5, last: { matsushima: '23:10', 'sendai-station': '00:12', late: '24:12', bad: '末班', num: 1390 } };
  assert.equal(lastDepartMin(link, 'matsushima'), 23 * 60 + 10);
  assert.equal(lastDepartMin(link, 'sendai-station'), 24 * 60 + 12, '00:12 是隔天凌晨');
  assert.equal(lastDepartMin(link, 'late'), 24 * 60 + 12, '寫 24:12 也一樣');
  assert.equal(lastDepartMin(link, 'bad'), null);
  assert.equal(lastDepartMin(link, 'num'), null, '只認 HH:MM 字串');
  assert.equal(lastDepartMin(link, 'elsewhere'), null, '這個方向沒寫');
  assert.equal(lastDepartMin({ mode: 'jr', rideMin: 38 }, 'matsushima'), null, '連結沒有 last');
  assert.equal(lastDepartMin({ last: { a: '03:59' } }, 'a'), 24 * 60 + 3 * 60 + 59);
  assert.equal(lastDepartMin({ last: { a: '04:00' } }, 'a'), 4 * 60, '04:00 起算當天');
});

test('搭車的 leg 帶末班：直達＝從起區發車的那一班，最晚離開＝發車 − 連結的走路分鐘；只有一個方向有資料時另一個方向沒有 last；沒資料的連結不帶這個鍵', () => {
  const links = {
    'station|sea': { mode: 'jr', rideMin: 38, walkMin: 5, last: { sea: '23:10', station: '23:40' } },
    'station|port': { mode: 'bus', rideMin: 35, walkMin: 5, last: { port: '20:30' } },
    'station|hill': { mode: 'bus', rideMin: 20, walkMin: 5 },
  };
  const legFn = makeLegFn({ settings, zoneLinks: links });
  const at = (zoneId) => ({ id: `p-${zoneId}`, zoneId });
  assert.deepEqual(legFn(at('sea'), at('station')), { walkMin: 5, rideMin: 38, climbMin: 0, mode: 'ride', source: 'link', last: { leaveByMin: 23 * 60 + 5, departMin: 23 * 60 + 10, fromZoneId: 'sea' } });
  assert.deepEqual(legFn(at('station'), at('sea')).last, { leaveByMin: 23 * 60 + 35, departMin: 23 * 60 + 40, fromZoneId: 'station' }, '反方向用另一端的時刻');
  assert.deepEqual(legFn(at('port'), at('station')).last, { leaveByMin: 20 * 60 + 25, departMin: 20 * 60 + 30, fromZoneId: 'port' });
  assert.equal('last' in legFn(at('station'), at('port')), false, '去程沒寫末班：不帶 last');
  assert.deepEqual(legFn(at('station'), at('hill')), { walkMin: 5, rideMin: 20, climbMin: 0, mode: 'ride', source: 'link' }, '沒資料的連結跟以前一模一樣');
  assert.equal(legFn.warnings.length, 0);
});

test('轉乘一次的末班：兩段各換成「最晚幾分要離開起點」，取先卡住的那一班；第二段的要扣掉第一段的走路與車程、再扣第二段的走路', () => {
  const links = {
    'sea|station': { mode: 'jr', rideMin: 38, walkMin: 5, last: { sea: '23:10', station: '23:40' } },
    'station|club': { mode: 'subway', rideMin: 8, walkMin: 5, last: { station: '23:50', club: '23:45' } },
    'station|town': { mode: 'walk', rideMin: 0, walkMin: 12 },
    'station|far': { mode: 'bus', rideMin: 60, walkMin: 5, last: { station: '21:00' } },
  };
  const legFn = makeLegFn({ settings, zoneLinks: links });
  // 海邊→（JR 38＋5）→車站→（地下鐵 8＋5）→夜店區：第一段 23:10 − 5＝23:05；第二段 23:50 − (5＋38) − 5＝23:02 → 先卡住的是車站 23:50 那班
  assert.deepEqual(legFn.linkBetween('sea', 'club').last, { leaveByMin: 23 * 60 + 2, departMin: 23 * 60 + 50, fromZoneId: 'station' });
  // 反方向：夜店區 23:45 − 5＝23:40；車站 23:40 − (5＋8) − 5＝23:22 → 車站那班先卡住
  assert.deepEqual(legFn.linkBetween('club', 'sea').last, { leaveByMin: 23 * 60 + 22, departMin: 23 * 60 + 40, fromZoneId: 'station' });
  // 第一段走路（沒有末班）、第二段搭車：一番町那種——走 12 分到車站，再扣上車前的 5 分
  assert.deepEqual(legFn.linkBetween('town', 'sea').last, { leaveByMin: 23 * 60 + 40 - 12 - 5, departMin: 23 * 60 + 40, fromZoneId: 'station' });
  assert.deepEqual(legFn.linkBetween('sea', 'town').last, { leaveByMin: 23 * 60 + 5, departMin: 23 * 60 + 10, fromZoneId: 'sea' }, '回程只有第一段有末班');
  // 第一段的末班比第二段早很多：海邊→車站→遠方，遠方的巴士 21:00 − 43 − 5＝20:12
  assert.deepEqual(legFn.linkBetween('sea', 'far').last, { leaveByMin: 20 * 60 + 12, departMin: 21 * 60, fromZoneId: 'station' });
  assert.deepEqual(legFn.linkBetween('town', 'club').last, { leaveByMin: 23 * 60 + 50 - 12 - 5, departMin: 23 * 60 + 50, fromZoneId: 'station' }, '走 12 分到車站再搭地下鐵：卡的是車站 23:50 那班');
  assert.equal(legFn.linkBetween('sea', 'sea'), null);
  assert.equal(legFn.linkBetween('sea', 'nowhere'), null);
  const leg = legFn({ id: 'a', zoneId: 'sea' }, { id: 'b', zoneId: 'club' });
  assert.deepEqual(leg, { walkMin: 10, rideMin: 46, climbMin: 0, mode: 'ride', source: 'link', via: 'station', last: { leaveByMin: 23 * 60 + 2, departMin: 23 * 60 + 50, fromZoneId: 'station' } });
});

test('rideLink：這一段照 legFn 的判斷會搭車才回連結（走得到的、走路連結的回 null），不記估算警告；linkBetween 回的是複本', () => {
  const links = { 'ichibancho|hachiman': { mode: 'bus', rideMin: 15, walkMin: 5, last: { hachiman: '21:30' } }, 'ichibancho|honcho': { mode: 'walk', rideMin: 0, walkMin: 8 } };
  const legFn = makeLegFn({ walk: { 'a|c': { min: 45, m: 3600 }, 'a|b': { min: 9, m: 700 } }, settings, zoneLinks: links });
  assert.deepEqual(legFn.rideLink(C, A), { rideMin: 15, walkMin: 5, mode: 'bus', hops: 1, total: 20, last: { leaveByMin: 21 * 60 + 25, departMin: 21 * 60 + 30, fromZoneId: 'hachiman' } }, 'C→A 直線估 40 幾分，超過 30 分改搭車');
  assert.equal(legFn.rideLink(A, B), null, '同區走 9 分');
  assert.equal(legFn.rideLink({ id: 'near', zoneId: 'hachiman', lat: 38.2610, lng: 140.8700 }, A), null, '跨區但走得到（≤30 分）：不算搭車');
  assert.equal(legFn.rideLink({ id: 'h', zoneId: 'honcho' }, { id: 'i', zoneId: 'ichibancho' }), null, '走路連結（rideMin 0）不算搭車');
  assert.equal(legFn.rideLink({ id: 'x', zoneId: 'nowhere' }, A), null, '沒有連結');
  assert.equal(legFn.warnings.length, 0, '探路不記「用直線距離估」的警告');
  const copy = legFn.linkBetween('hachiman', 'ichibancho'); copy.rideMin = 999;
  assert.equal(legFn.linkBetween('hachiman', 'ichibancho').rideMin, 15, '改複本不影響 legFn');
  assert.throws(() => { legFn.linkBetween('hachiman', 'ichibancho').last.leaveByMin = 0; }, TypeError, '末班物件是凍結的');
});
