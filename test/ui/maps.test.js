// Google Maps 深連結：可信座標用經緯度、不可信用文字（maps_query → 當地名＋城市名）；路線沒 from 就不帶 origin；搭車段 transit。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordQuery, placeQuery, placeUrl, routeUrl, legMode, tripCityName } from '../../src/ui/maps.js';

const exact = { id: 'a', name_zh: '大崎八幡宮（國寶）', name_local: '大崎八幡宮', lat: 38.2716378, lng: 140.8448528, coordConfidence: 'exact' };
const zone = { id: 'b', name_zh: '陸奧國一宮 鹽竈神社', name_local: '志波彦神社鹽竈神社', lat: 38.317, lng: 141.023, coordConfidence: 'zone' };
const param = (url, key) => new URL(url).searchParams.get(key);

test('exact／address／manual 的座標算可信：小數五位的 lat,lng', () => {
  assert.equal(placeQuery(exact, '仙台'), '38.27164,140.84485');
  assert.equal(placeQuery({ ...exact, coordConfidence: 'address' }, '仙台'), '38.27164,140.84485');
  assert.equal(placeQuery({ ...exact, coordConfidence: 'manual' }, '仙台'), '38.27164,140.84485');
});

test('沒有 coordConfidence 但有數字座標（示範資料、住宿）也用座標', () => {
  const home = { id: 'home', name_zh: '飯店（仙台站西口）', lat: 38.2601, lng: 140.8824 };
  assert.equal(coordQuery(home), '38.26010,140.88240');
  assert.equal(placeQuery(home, '仙台'), '38.26010,140.88240');
});

test('zone／fuzzy／unzoned／unknown 的座標會指到別處：用文字查，maps_query 優先', () => {
  for (const conf of ['zone', 'fuzzy', 'unzoned', 'unknown']) {
    assert.equal(coordQuery({ ...zone, coordConfidence: conf }), null, conf);
    assert.equal(placeQuery({ ...zone, coordConfidence: conf }, '仙台'), '志波彦神社鹽竈神社 仙台', conf);
  }
  assert.equal(placeQuery({ ...zone, maps_query: '鹽竈神社 塩竈市' }, '仙台'), '鹽竈神社 塩竈市', '知識庫寫的查詢字串照用、不再加城市');
});

test('文字查：沒 name_local 用 name_zh；沒城市名就只有店名；可信等級但座標是 null 也退回文字', () => {
  assert.equal(placeQuery({ name_zh: '珈巣多夢', lat: null, lng: null }, '仙台'), '珈巣多夢 仙台');
  assert.equal(placeQuery({ name_zh: '珈巣多夢', lat: null, lng: null }), '珈巣多夢');
  assert.equal(placeQuery({ name_zh: '珈巣多夢', lat: null, lng: null, coordConfidence: 'exact' }, '仙台'), '珈巣多夢 仙台');
});

test('placeUrl 是 search?api=1&query=…，query 有 encode', () => {
  const url = placeUrl(zone, '仙台');
  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(!url.includes(' '), '空白要 encode');
  assert.equal(param(url, 'query'), '志波彦神社鹽竈神社 仙台');
  assert.equal(param(placeUrl(exact), 'query'), '38.27164,140.84485');
});

test('routeUrl：有 from 帶 origin、沒 from 不帶（Google Maps 用現在位置）；ride → transit、其餘 walking', () => {
  const withFrom = routeUrl({ from: exact, to: zone, mode: 'walk', cityName: '仙台' });
  assert.ok(withFrom.startsWith('https://www.google.com/maps/dir/?api=1&'));
  assert.equal(param(withFrom, 'origin'), '38.27164,140.84485');
  assert.equal(param(withFrom, 'destination'), '志波彦神社鹽竈神社 仙台');
  assert.equal(param(withFrom, 'travelmode'), 'walking');
  const noFrom = routeUrl({ to: exact, mode: 'ride' });
  assert.equal(param(noFrom, 'origin'), null);
  assert.ok(!noFrom.includes('origin='));
  assert.equal(param(noFrom, 'destination'), '38.27164,140.84485');
  assert.equal(param(noFrom, 'travelmode'), 'transit');
  assert.equal(param(routeUrl({ to: exact }), 'travelmode'), 'walking', 'mode 沒給就走路');
});

test('legMode：mode 有給照它，沒給看 rideMin', () => {
  assert.equal(legMode({ walkMin: 5, rideMin: 20, mode: 'ride' }), 'ride');
  assert.equal(legMode({ walkMin: 5, rideMin: 20 }), 'ride');
  assert.equal(legMode({ walkMin: 8, rideMin: 0 }), 'walk');
  assert.equal(legMode(null), 'walk');
});

test('tripCityName：打包檔城市名 → 旅程 cityName → cityId → 空字串', () => {
  assert.equal(tripCityName({ packMeta: { city: { name_zh: '仙台' } }, trip: { cityName: '別的' } }), '仙台');
  assert.equal(tripCityName({ packMeta: null, trip: { cityName: '仙台' } }), '仙台');
  assert.equal(tripCityName({ trip: { cityId: 'sendai' } }), 'sendai');
  assert.equal(tripCityName({}), '');
});
