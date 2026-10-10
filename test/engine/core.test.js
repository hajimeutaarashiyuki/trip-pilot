// T4：核心搜尋。小候選集就能看出：守營業時間、never 的站進 dropped 帶理由、會避開咖啡廳連排、永遠回得出東西、節點預算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay } from '../../src/engine/core.js';
import { placeStop } from '../../src/engine/schedule.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const settings = rulesJson.settings;
const rules = loadRules(BUILTIN, rulesJson.rules);
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] } };
const kb = { zones: { town: { environment: 'urban' } } };
const home = { id: 'home', name_zh: '飯店', zoneId: 'town' };
const ALL = { thu: [['09:00', '23:00']] };
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'shrine', walkFactor: 0.5, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 60, ...over });
const day = (over = {}) => ({ date: '2026-08-13', type: 'normal', earlyDay: false, party: 1, dayTripNext: false, themeCategory: null, prevThemeCategory: null, anchorPoiId: null, designated: [], regionZones: ['town'], window: { startMin: 9 * 60, endMin: 24 * 60 }, ...over });
const flatLeg = () => ({ walkMin: 10, rideMin: 0, climbMin: 0 });

test('placeStop：開門前到就等到開門；固定時段提前到位', () => {
  const p = placeStop({ prevEndMin: 9 * 60, leg: { walkMin: 10 }, poi: poi('x', { hours: { thu: [['10:00', '18:00']] } }), dwellMin: 60, date: '2026-08-13' });
  assert.equal(p.arriveMin, 9 * 60 + 10); assert.equal(p.startMin, 10 * 60); assert.equal(p.waitMin, 50); assert.equal(p.endMin, 11 * 60);
  const f = placeStop({ prevEndMin: 18 * 60, leg: { walkMin: 10 }, poi: poi('花火'), dwellMin: 20, date: '2026-08-13', fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(f.startMin, 19 * 60);
});

test('守營業時間、主行程必排、指定站一定在、沒開的進 dropped 帶理由', () => {
  const cands = [
    { poi: poi('神社', { hours: { thu: [['09:00', '16:00']] } }), priority: 'want', isAnchor: true },
    { poi: poi('午餐', { category: 'food', walkFactor: 0, recovery: true, hours: { thu: [['11:30', '14:00']] } }), priority: 'want' },
    { poi: poi('古著', { category: 'vintage', walkFactor: 0, hours: { thu: [['12:00', '20:00']] } }), priority: 'must', designated: true },
    { poi: poi('休週四', { hours: { mon: [['09:00', '17:00']] } }), priority: 'want' },
    { poi: poi('夜間站', { category: 'bar', walkFactor: 0, recovery: true, hours: { thu: [['17:00', '26:00']] } }), priority: 'want' },
  ];
  const r = planDay({ candidates: cands, day: day({ anchorPoiId: '神社', anchorName: '神社', designated: ['古著'] }), home, legFn: flatLeg, rules, settings, country, kb, options: { explain: true } });
  const ids = r.sequence.map((s) => s.poi.id);
  assert.ok(r.complete, '主行程有排進去');
  assert.ok(ids.includes('神社') && ids.includes('古著') && ids.includes('午餐') && ids.includes('夜間站'), ids.join(','));
  assert.ok(!ids.includes('休週四'));
  const dropped = r.dropped.find((d) => d.poi.id === '休週四');
  assert.match(dropped.reason, /今天沒開/);
  for (const s of r.sequence) assert.ok(s.startMin >= 9 * 60 && s.endMin <= 24 * 60);
  const lunch = r.sequence.find((s) => s.poi.id === '午餐');
  assert.ok(lunch.startMin >= 11 * 60 + 30 && lunch.endMin <= 14 * 60, '午餐在營業時間內');
  assert.ok(r.breakdown && r.breakdown.stops.length === r.sequence.length);
  assert.ok(r.stats.ms < 1000 && !r.stats.truncated, `${r.stats.nodes} 節點 ${r.stats.ms} ms`);
});

test('兩家咖啡廳都想去時不排連著；有第三家可插就插中間', () => {
  const cafe = (id) => ({ poi: poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true }), priority: 'want' });
  const cands = [cafe('咖啡A'), cafe('咖啡B'), { poi: poi('唱片行', { category: 'record', walkFactor: 0 }), priority: 'want' }];
  const r = planDay({ candidates: cands, day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  const ids = r.sequence.map((s) => s.poi.id);
  assert.equal(ids.length, 3);
  assert.notEqual(ids.indexOf('唱片行'), 0 === 1 ? 0 : -1);
  assert.equal(ids[1], '唱片行', `唱片行要夾在中間：${ids.join('→')}`);
  assert.ok(!r.warnings.some((w) => w.ruleId === 'cafe-adjacent'));
});

test('沒有候選也回得出東西；節點預算用完回目前最好的', () => {
  const empty = planDay({ candidates: [], day: day(), home, legFn: flatLeg, rules, settings, country, kb });
  assert.deepEqual(empty.sequence, []);
  assert.ok(empty.warnings.some((w) => w.ruleId === 'meal-slots'));
  const many = Array.from({ length: 11 }, (_, i) => ({ poi: poi(`p${i}`, { category: i % 2 ? 'vintage' : 'shrine', walkFactor: i % 2 ? 0 : 0.5 }), priority: 'maybe' }));
  const r = planDay({ candidates: many, day: day(), home, legFn: flatLeg, rules, settings, country, kb, options: { maxNodes: 500 } });
  assert.ok(r.stats.truncated);
  assert.ok(r.sequence.length > 0);
});

test('placeStop：當天第一站要等開門，就改成晚點出門，不在門口等', () => {
  const x = poi('x', { hours: { thu: [['10:00', '18:00']] } });
  const g = placeStop({ prevEndMin: 9 * 60, leg: { walkMin: 10 }, poi: x, dwellMin: 60, date: '2026-08-13', dayStartMin: 9 * 60, first: true });
  assert.equal(g.waitMin, 0); assert.equal(g.arriveMin, 10 * 60); assert.equal(g.startMin, 10 * 60); assert.equal(g.endMin, 11 * 60);
  // 不是第一站就照舊：到了等
  const h = placeStop({ prevEndMin: 9 * 60, leg: { walkMin: 10 }, poi: x, dwellMin: 60, date: '2026-08-13', dayStartMin: 9 * 60, first: false });
  assert.equal(h.waitMin, 50);
});
