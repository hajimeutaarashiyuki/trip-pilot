// kb-check 的統計（純函式）：必填欄位、店型、營業時間、歸區、座標、重複 id、結論；同店多類別不算撞名、同連鎖不同分店算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkKb, formatReport, REQUIRED_FIELDS, THRESHOLDS } from '../../tools/kb-check.mjs';

const rows = [
  { name_zh: '甲神社', name_local: '甲神社', category: '神社', area: '北町（北町1-1）', hours: '9:00-17:00', maps_query: '甲神社' },
  { name_zh: '乙', name_local: '', category: '看不出來的店型', area: '南町', hours: '看心情', maps_query: '' },
  { name_zh: '丙喫茶', name_local: '丙喫茶', category: '喫茶', area: '北町（北町2-1）', hours: '10:00-18:00；週二公休', maps_query: '丙喫茶' },
  { name_zh: '🧴藥膏｜丙喫茶（順路）', name_local: '丙喫茶', category: '藥妝', area: '北町（北町2-1）', hours: '10:00-18:00', maps_query: '丙喫茶' },
  { name_zh: '地下鐵', name_local: '地下鉄', category: '交通｜地下鐵', area: '全域', hours: '—', maps_query: '地下鉄' },
  { name_zh: '丁食堂', name_local: 'ていしょくや', category: '定食', area: '西町', hours: '11:00-14:00', maps_query: '丁食堂' },
  { name_zh: '戊食堂', name_local: 'ていしょくや', category: '定食', area: '東町', hours: '11:00-14:00', maps_query: '戊食堂' },  // 不同店、同 name_local → 同一個 id，撞名
];

test('checkKb：缺欄位、店型認不出、時段看不出、沒歸區、沒座標、撞名都數得出來，結論是先補', () => {
  const zones = { kita: { keywords: ['北町'] }, minami: { keywords: ['南町'] } };
  const coords = { 甲神社: { lat: 35, lng: 135, confidence: 'exact' }, 乙: null, 丙喫茶: { lat: 35, lng: 135, confidence: 'zone' } };
  const s = checkKb({ data: { categories: { x: { items: rows } } }, zones, coords });
  assert.equal(s.rows, 7);
  assert.equal(s.stations, 5);
  assert.equal(s.notPlaces, 1);
  assert.deepEqual(s.missing, { name_local: ['乙'], maps_query: ['乙'] });
  assert.equal(s.category.recognized, 4);
  assert.deepEqual(s.category.unknown, ['乙［看不出來的店型］']);
  assert.deepEqual(s.hours, { applicable: 4, parsed: 3, partial: 0, unparsed: ['乙'] });
  assert.deepEqual(s.zones, { total: 2, zoned: 3, unzoned: ['丁食堂'] });
  assert.equal(s.coords.needed, 4);
  assert.equal(s.coords.covered, 2);
  assert.deepEqual(s.coords.byConfidence, { exact: 1, zone: 1 });
  assert.deepEqual(s.coords.nulls, ['乙']);
  assert.deepEqual(s.coords.absent, ['丁食堂']);
  assert.equal(s.coords.lowConfidence, 1);
  assert.deepEqual(s.duplicates.map((d) => [d.id, d.names.length, d.sameStore]), [['丙喫茶', 2, true], ['ていしょくや', 2, false]]);
  assert.equal(s.verdict.ok, false);
  assert.equal(s.verdict.blocking.length, 6, s.verdict.blocking.join(' / '));
  const report = formatReport(s, 'test');
  assert.match(report.split('\n').at(-1), /^結論：先補這些：/);
  assert.match(report, /撞名：丁食堂／戊食堂/);
  assert.match(report, /同店多類別/);
});

test('checkKb：乾淨的資料、還沒有 zones／coords → 可以打包，歸區與座標寫跳過', () => {
  const s = checkKb({ data: { categories: { x: { items: [rows[0], rows[2], rows[4]] } } } });
  assert.equal(s.verdict.ok, true, s.verdict.blocking.join(' / '));
  assert.equal(s.zones, null);
  assert.equal(s.coords, null);
  assert.equal(s.hours.applicable, 2, '交通類不算營業時間');
  const report = formatReport(s);
  assert.match(report, /沒有 zones\.json/);
  assert.match(report, /沒有 coords\.json/);
  assert.equal(report.split('\n').at(-1), '結論：可以打包');
  assert.ok(REQUIRED_FIELDS.includes('maps_query'));
  assert.ok(THRESHOLDS.zonedRate > 0 && THRESHOLDS.zonedRate <= 1);
});
