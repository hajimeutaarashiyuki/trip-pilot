// 現場改案的池（ui/now.js fieldPool；T19 審查後「累了」與硬時限受威脅兩組共用）：當日區域內、扣掉今天排了的、別天排了的、按過「不去了」的、錢湯、
// 引擎本來就不主動排的（engineMayInsert）、在場的人不想去的店型；丟給 replanDay 的五種策略時降速那案不會插同行者不去的咖啡廳。純函式，不碰 DOM。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldPool } from '../../src/ui/now.js';
import { replanDay, STRATEGIES, TIRED_STRATEGIES } from '../../src/strategies/index.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = { fri: [['09:00', '23:00']] };   // 2026-08-14 週五
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 70, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const cafe = (id, over = {}) => poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, dwellMin: 40, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0 });

const streets = [poi('街區A'), poi('街區B'), poi('街區C')];
const all = [...streets, cafe('咖啡廳'), poi('食堂', { category: 'food', walkFactor: 0, recovery: true, dwellMin: 45 }), poi('錢湯', { category: 'onsen', walkFactor: 0, recovery: true }),
  cafe('挖寶咖啡', { curated: false }), cafe('別天的咖啡'), cafe('不去了的咖啡'), cafe('別區的咖啡', { zoneId: 'far' })];
const pois = Object.fromEntries(all.map((p) => [p.id, p]));
const seqOf = (ids) => ids.map((id, i) => ({ poi: pois[id], priority: 'must', dwellMin: 70, startMin: 13 * 60 + i * 80 }));
const plannedOf = (adjust) => ({ day: { date: '2026-08-14', regionZones: ['town'], window: { startMin: 540, endMin: 1440 }, adjust }, plan: { sequence: seqOf(['街區A', '街區B', '街區C']) } });
const stateOf = (planned) => ({ pois, plans: { '2026-08-14': planned, '2026-08-15': { day: {}, plan: { sequence: seqOf(['別天的咖啡']) } } }, trip: { days: [{ date: '2026-08-14', removed: [{ poiId: '不去了的咖啡' }] }, { date: '2026-08-15' }] } });

test('fieldPool：當日區域內、扣掉今天排了的、別天排了的、按過不去了的、錢湯、挖寶型；在場的人不想去的店型也不拿', () => {
  const plain = plannedOf({ stamina: 'normal', nightSlot: 'default', avoidCategories: [], avoidBy: {} });
  assert.deepEqual(fieldPool(stateOf(plain), plain, plain.plan.sequence).map((c) => c.poi.id).sort(), ['咖啡廳', '食堂'].sort());
  const avoided = plannedOf({ stamina: 'normal', nightSlot: 'default', avoidCategories: ['cafe'], avoidBy: {} });
  assert.deepEqual(fieldPool(stateOf(avoided), avoided, avoided.plan.sequence).map((c) => c.poi.id), ['食堂']);
  const noAdjust = plannedOf(undefined);
  assert.deepEqual(fieldPool(stateOf(noAdjust), noAdjust, noAdjust.plan.sequence).map((c) => c.poi.id).sort(), ['咖啡廳', '食堂'].sort(), '沒 adjust（舊快照）照舊');
});

test('硬時限受威脅那組（五種策略）與「累了」那組拿 fieldPool：同行者不去咖啡廳 → 降速／只坐一下插的是食堂不是咖啡廳；整個知識庫當 pool 才會插咖啡廳（10-16 審查的探針）', () => {
  const avoided = plannedOf({ stamina: 'normal', nightSlot: 'default', avoidCategories: ['cafe'], avoidBy: {} });
  const state = stateOf(avoided);
  const remaining = avoided.plan.sequence;
  const run = (pool, strategies) => replanDay({ day: avoided.day, remaining, here: home, nowMin: 13 * 60, rules, settings, country, kb, legFn, pool, strategies }).proposals;
  const inserted = (proposals) => proposals.flatMap((p) => p.plan.sequence.filter((s) => s.insertedBy === 'engine').map((s) => s.poi.id));
  const raw = all.map((p) => ({ poi: p }));   // 之前受威脅那組退到的 state.pool（整個知識庫）
  const control = inserted(run(raw, STRATEGIES));
  assert.ok(control.includes('咖啡廳'), `整個知識庫當 pool 時降速會插咖啡廳（對照組）：${control.join(',')}`);
  for (const strategies of [STRATEGIES, TIRED_STRATEGIES]) {
    const ins = inserted(run(fieldPool(state, avoided, remaining), strategies));
    assert.ok(ins.length > 0 && ins.every((id) => id === '食堂'), `過了 fieldPool 只會插食堂：${ins.join(',')}`);
  }
});
