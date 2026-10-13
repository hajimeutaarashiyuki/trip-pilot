// zones 草案的純函式：貪婪聚類、area 拆詞（去城市名與數字）、命名、keywords 只歸一區、區等級的字丟掉、半徑下限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterPois, areaTokens, areaPrefix, slugify, mostCommon, zoneDraft, MIN_RADIUS_M } from '../../src/geo/zones-init.js';
import { haversineM } from '../../src/geo/matrix.js';
import { zoneOfPoi } from '../../src/geo/zones.js';

test('clusterPois：依序放進半徑內最近的群，否則開新群；群心是平均；沒座標的跳過', () => {
  const pois = [
    { id: 'a', lat: 35.000, lng: 135.000 },
    { id: 'b', lat: 35.003, lng: 135.000 },    // 離 a 約 330 m → 同群
    { id: 'c', lat: 35.020, lng: 135.000 },    // 離 ab 群心約 2 km → 新群
    { id: 'd', lat: 35.0205, lng: 135.0005 },  // 離 c 約 70 m
    { id: 'e', lat: null, lng: null },
    { id: 'f', lat: 35.0115, lng: 135.000 },   // 離 ab 群心約 1.1 km、離 cd 群心約 970 m → 800 以內都沒有，新群
  ];
  const cs = clusterPois(pois, { radiusM: 800 });
  assert.deepEqual(cs.map((c) => c.members.map((p) => p.id)), [['a', 'b'], ['c', 'd'], ['f']]);
  assert.ok(Math.abs(cs[0].center.lat - 35.0015) < 1e-9);
  // 半徑放大到 1200：f 離 cd 群心比較近，歸 cd
  const cs2 = clusterPois(pois, { radiusM: 1200 });
  assert.deepEqual(cs2.map((c) => c.members.map((p) => p.id)), [['a', 'b'], ['c', 'd', 'f']]);
});

test('areaTokens：拆括號與標點、剝掉城市名前綴、丟城市名、純數字與地址號碼、太短的', () => {
  assert.deepEqual(areaTokens('八幡（仙台市青葉區，仙台站西北方）', { cityNames: ['仙台'] }), ['八幡', '青葉區', '仙台站西北方']);
  assert.deepEqual(areaTokens('北町（偽町市北町1-2-3，北町商店街入口）', { cityNames: ['偽町'] }), ['北町', '北町商店街入口']);
  assert.deepEqual(areaTokens('南町（南町3-4 2F）'), ['南町']);
  assert.deepEqual(areaTokens('仙台市區／仙台全域（青葉区中央2-2-24）', { cityNames: ['仙台'] }), ['青葉区中央']);
  assert.deepEqual(areaTokens('向山・愛宕山（仙台市太白區，廣瀨川南岸）', { cityNames: ['仙台'] }), ['向山', '愛宕山', '太白區', '廣瀨川南岸']);
  assert.deepEqual(areaTokens(''), []);
});

test('areaPrefix／slugify／mostCommon', () => {
  assert.equal(areaPrefix('八幡（仙台市青葉區，仙台站西北方）'), '八幡');
  assert.equal(areaPrefix('仙台站前 クリスロード商店街（青葉區中央2-2-24）'), '仙台站前 クリスロード商店街');
  assert.equal(slugify('Sendai Station 東口'), 'sendai-station-東口');
  assert.equal(mostCommon(['a', 'b', 'b', 'a']), 'a', '同票取先出現');
  assert.equal(mostCommon([]), null);
});

test('zoneDraft：id 取最常見的詞、撞名加數字、name_zh 取前綴、keywords 去城市名且只歸一區、半徑至少 400、links 空', () => {
  const mk = (lat, lng, area) => ({ lat, lng, area });
  const clusters = clusterPois([
    mk(35.000, 135.000, '北町（偽町市北町1-2-3，北町商店街入口）'),
    mk(35.003, 135.000, '北町（北町2-5，神社隣）'),
    mk(34.990, 135.000, '南町（偽町市南町3-1）'),
    mk(34.989, 135.004, '南町（南町3-4 2F）'),
    mk(35.050, 135.000, '北町（飛地，北町公園）'),   // 遠處另一群，最常見的詞也是北町 → id 撞名
  ], { radiusM: 800 });
  const draft = zoneDraft(clusters, { cityNames: ['假城', '偽町'], radiusM: 800 });
  assert.deepEqual(Object.keys(draft.zones), ['北町', '南町', '北町-2']);
  const kita = draft.zones['北町'];
  assert.equal(kita.name_zh, '北町');
  assert.deepEqual(kita.keywords, ['北町', '北町商店街入口', '神社隣']);
  assert.equal(kita.environment, 'urban');
  assert.ok(kita.radiusM >= MIN_RADIUS_M);
  assert.ok(kita.radiusM >= Math.max(...clusters[0].members.map((p) => haversineM(p, clusters[0].center))));
  assert.ok(!Object.values(draft.zones).some((z) => z.keywords.some((k) => k.includes('偽町'))));
  // 「北町」兩群都有：歸出現次數多的那群（第一群 2 次、飛地 1 次），飛地只剩自己獨有的詞
  assert.deepEqual(draft.zones['北町-2'].keywords, ['飛地', '北町公園']);
  assert.deepEqual(draft.links, {});
  assert.match(draft._說明, /直線估/);
  assert.match(draft._說明, /urban/);
  // 歸區：沒座標但 area 有「南町」的站也歸得到
  assert.equal(zoneOfPoi({ area: '南町（南町公園旁）' }, draft.zones), '南町');
});

test('zoneDraft：散在 3 群以上的詞（青葉區）是區等級的字，不進任何一區的 keywords', () => {
  const clusters = clusterPois([
    { lat: 35.00, lng: 135.00, area: '八幡（仙台市青葉區）' },
    { lat: 35.02, lng: 135.00, area: '北山（仙台市青葉區）' },
    { lat: 35.04, lng: 135.00, area: '上杉（仙台市青葉區）' },
  ], { radiusM: 800 });
  const draft = zoneDraft(clusters, { cityNames: ['仙台'] });
  assert.deepEqual(Object.keys(draft.zones), ['八幡', '北山', '上杉']);
  assert.deepEqual(Object.values(draft.zones).map((z) => z.keywords), [['八幡'], ['北山'], ['上杉']]);
});
