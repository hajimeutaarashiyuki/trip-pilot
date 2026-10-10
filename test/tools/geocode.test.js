// 查座標的純邏輯（不打網路）：拆複合名、從 area 抽地址、查詢順序、名字比對、區內才收、exact 先收否則留等級最高的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitName, addressesOf, queriesFor, nameMatches, inZone, geocodePoi } from '../../tools/geocode.mjs';

test('splitName：＋／・與括號都拆，太短的丟掉', () => {
  assert.deepEqual(splitName('ハピナ名掛丁＋クリスロード＋マーブルロードおおまち'), ['ハピナ名掛丁', 'クリスロード', 'マーブルロードおおまち']);
  assert.deepEqual(splitName('Cafe de 埃比昂（70年老舖純喫茶）'), ['Cafe de 埃比昂', '70年老舖純喫茶']);
  assert.deepEqual(splitName('Utah'), []);
});

test('addressesOf：整個地址＋丁目層，區字轉日文', () => {
  assert.deepEqual(addressesOf('仙台站前 クリスロード商店街（青葉區中央2-2-24）【地址已查核無誤】', '仙台'), ['仙台市青葉区中央2-2-24', '仙台市青葉区中央2丁目']);
  assert.deepEqual(addressesOf('一番町（北段，山一商店ビル 3F）', '仙台'), []);
});

test('queriesFor：maps_query、原文名、拆段、中文名、地址，不重複', () => {
  const qs = queriesFor({ maps_query: 'SQUAT 仙台', name_local: 'SQUAT 仙台店', name_zh: 'SQUAT（古著）', area: '本町（本町1-14-30 1F）' }, '仙台');
  assert.deepEqual(qs.map((x) => x.q), ['SQUAT 仙台', 'SQUAT 仙台店 仙台', 'SQUAT（古著） 仙台', '仙台市本町1-14-30', '仙台市本町1丁目']);
  assert.equal(qs.at(-1).kind, 'address');
});

test('nameMatches：地名含店名前 4 字才算；英文店名對片假名不算', () => {
  assert.equal(nameMatches({ display: 'クラブセガ, クリスロード', name: 'クラブセガ' }, { name_local: 'SEGA-RU', name_zh: 'SEGA-RU' }), false);
  assert.equal(nameMatches({ display: '喫茶エルベ, 南町通', name: '喫茶エルベ' }, { name_local: '喫茶エルベ', name_zh: '喫茶 Elbe' }), true);
});

test('inZone：區心兩倍半徑內（至少 1.5 km）；沒區就不擋', () => {
  const zone = { lat: 38.2601, lng: 140.8824, radiusM: 700 };
  assert.equal(inZone({ lat: 38.2650, lng: 140.8824 }, zone), true);   // 約 550 m
  assert.equal(inZone({ lat: 38.2000, lng: 140.8824 }, zone), false);  // 約 6.7 km
  assert.equal(inZone({ lat: 38.2000, lng: 140.8824 }, null), true);
});

test('geocodePoi：區外的候選跳過；exact 立刻收；否則地址勝過 fuzzy', async () => {
  const zone = { id: 'ichibancho', lat: 38.2612, lng: 140.8716, radiusM: 900 };
  const poi = { name_local: 'フロリダ 仙台店', name_zh: '古著屋フロリダ', area: '一番町（一番町4-3-26）' };
  const seen = [];
  const lookup = async (q) => {
    seen.push(q);
    if (q.startsWith('フロリダ')) return [{ lat: 38.2000, lng: 140.9000, name: '避難階段', display: '避難階段, 仙台南部道路', source: 'photon' }];
    if (q.startsWith('古著屋')) return [{ lat: 38.2620, lng: 140.8720, name: 'なんか別の店', display: 'なんか別の店, 一番町', source: 'photon' }];
    if (q === '仙台市一番町4-3-26') return [{ lat: 38.2630, lng: 140.8718, name: '', display: '4-3-26, 一番町, 青葉区', source: 'nominatim' }];
    return [];
  };
  const r = await geocodePoi(poi, '仙台', zone, lookup);
  assert.equal(r.confidence, 'address');
  assert.equal(r.query, '仙台市一番町4-3-26');
  assert.equal(r.zoneId, 'ichibancho');
  // exact：第一個查到就回，後面不查
  const seen2 = [];
  const lookup2 = async (q) => { seen2.push(q); return [{ lat: 38.2615, lng: 140.8716, name: 'フロリダ', display: 'フロリダ, 一番町', source: 'photon' }]; };
  const e = await geocodePoi(poi, '仙台', zone, lookup2);
  assert.equal(e.confidence, 'exact');
  assert.equal(seen2.length, 1);
});
