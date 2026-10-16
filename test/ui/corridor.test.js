// 走廊清單的畫面邏輯（T15；原話 #57、#124）：純函式——哪段有哪些店、長段提示、升級成站（加進 picks 並重排後它就是站）、「我進去了」只記裝置；
// 現場套過改案的序列（applied.js appliedPlan）走廊跟著新序列重算。比照 applied.test 的做法，不碰 DOM。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { appliedPlan } from '../../src/ui/applied.js';
import { corridorOfLeg, legSuggestOf, upgradePick, visitedPatch, visitedDates, corridorNames, shortName } from '../../src/ui/corridor.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = { thu: [['09:00', '23:00']] };
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const shop = (id, lat, lng) => poi(id, { category: 'record', walkFactor: 0, dwellMin: 30, lat, lng });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const A = poi('A', { lat: 38.26, lng: 140.88 }); const B = poi('B', { lat: 38.26, lng: 140.89 });
const near = shop('近33', 38.2603, 140.875); const mid = shop('AB中', 38.2602, 140.885);
const WALK = { 'home|A': 11, 'A|B': 5, 'home|B': 20 };
const legFn = (a, b) => ({ walkMin: WALK[`${a.id}|${b.id}`] ?? WALK[`${b.id}|${a.id}`] ?? 20, rideMin: 0, climbMin: 0, mode: 'walk' });
const pois = { A, B, 近33: near, AB中: mid };
const mkTrip = (dayOver = {}) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days: [{ date: '2026-08-13', type: 'normal', designated: ['A', 'B'], picks: [{ poiId: 'A', priority: 'must' }, { poiId: 'B', priority: 'must' }], ...dayOver }] });
const plansOf = (trip) => planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool: Object.values(pois) }).days[0];

test('corridorOfLeg／legSuggestOf：第 0 段是住宿→第一站；沒那段、沒 corridor 都回空；長段提示對到那段', () => {
  const { plan } = plansOf(mkTrip());
  assert.deepEqual(corridorOfLeg(plan, 0).map((x) => x.poi.id), ['近33']);
  assert.deepEqual(corridorOfLeg(plan, 1).map((x) => x.poi.id), ['AB中']);
  assert.deepEqual(corridorOfLeg(plan, 2), []);
  assert.deepEqual(corridorOfLeg({ sequence: [] }, 0), []);
  assert.deepEqual(corridorOfLeg(null, 0), []);
  assert.equal(legSuggestOf(plan, 0)?.walkMin, 11, '住宿→A 走 11 分有店：提示');
  assert.equal(legSuggestOf(plan, 1), null, 'A→B 走 5 分：不提示');
  assert.equal(legSuggestOf(null, 0), null);
});

test('upgradePick：加進那天的 picks（priority want）、已經在就不重複、removed 裡同一家拿掉、不改傳入的 day；重排後它就是站、不再在走廊清單裡', () => {
  const trip = mkTrip();
  const day = trip.days[0];
  const patch = upgradePick(day, '近33');
  assert.deepEqual(patch.picks, [{ poiId: 'A', priority: 'must' }, { poiId: 'B', priority: 'must' }, { poiId: '近33', priority: 'want' }]);
  assert.deepEqual(patch.removed, []);
  assert.equal(day.picks.length, 2, '不改傳入的 day');
  assert.equal(upgradePick({ picks: patch.picks }, '近33').picks, patch.picks, '已經在就回同一個陣列');
  assert.deepEqual(upgradePick({ picks: [], removed: [{ poiId: '近33' }, { poiId: 'x' }] }, '近33'), { picks: [{ poiId: '近33', priority: 'want' }], removed: [{ poiId: 'x' }] });
  assert.deepEqual(upgradePick(undefined, 'y'), { picks: [{ poiId: 'y', priority: 'want' }], removed: [] });
  // app.js upgradeCorridor 的效果：Object.assign(day, patch) 再 planTrip
  Object.assign(day, patch);
  const { plan } = plansOf(trip);
  const placed = plan.sequence.find((s) => s.poi.id === '近33');
  assert.ok(placed, `升級後要排進序列：${plan.sequence.map((s) => s.poi.id).join('→')}；落選 ${JSON.stringify(plan.dropped.map((d) => d.reason))}`);
  assert.ok(!placed.insertedBy, '是他勾的站，不是引擎插的');
  assert.equal(placed.priority, 'want');
  assert.ok(!plan.corridor.some((c) => c.pois.some((x) => x.poi.id === '近33')), '升級後不再在走廊清單裡');
});

test('visitedPatch：field.visited[poiId] = { date, at }，舊的留著、再按一次蓋新時刻、不改傳入的 field；corridorNames 取前幾家與剩下幾家', () => {
  const field = { date: '2026-08-13', index: 0, visited: { x: { date: '2026-08-12', at: 'T0' } } };
  const p = visitedPatch(field, '2026-08-13', 'y', 'T1');
  assert.deepEqual(p, { visited: { x: { date: '2026-08-12', at: 'T0' }, y: { date: '2026-08-13', at: 'T1' } } });
  assert.deepEqual(visitedDates({ ...p.visited, z: { at: 'T2' }, w: null }), { x: '2026-08-12', y: '2026-08-13' }, '引擎吃的去過表只留有日期的');
  assert.deepEqual(visitedDates(undefined), {});
  assert.deepEqual(Object.keys(field.visited), ['x']);
  assert.deepEqual(visitedPatch({ ...field, ...p }, '2026-08-14', 'y', 'T2').visited.y, { date: '2026-08-14', at: 'T2' });
  assert.deepEqual(visitedPatch(undefined, '2026-08-13', 'z', 'T3'), { visited: { z: { date: '2026-08-13', at: 'T3' } } }, '舊版存的 field 沒有 visited');
  const list = [1, 2, 3, 4, 5].map((n) => ({ poi: { id: `p${n}`, name_zh: `店${n}` }, distM: n }));
  assert.deepEqual(corridorNames(list, 3), { names: ['店1', '店2', '店3'], more: 2 });
  assert.deepEqual(corridorNames(list.slice(0, 2), 3), { names: ['店1', '店2'], more: 0 });
  assert.deepEqual(corridorNames([], 3), { names: [], more: 0 });
});

test('appliedPlan：現場套過改案的序列走廊跟著重算（legIndex 對到新序列）、長段提示跟著重出；沒給 pois 就是空的', () => {
  const trip = mkTrip();
  const planned = plansOf(trip);
  assert.deepEqual(planned.plan.corridor.map((c) => c.legIndex), [0, 1]);
  // 改案：只剩 B（A 砍了）→ 住宿→B 一段 20 分，A 旁與 AB 中段的店都歸這段（AB中 離這條線 22 m、近33 33 m，近的在前）
  const sequence = planned.plan.sequence.filter((s) => s.poi.id === 'B');
  const next = appliedPlan({ planned, sequence, appliedIndex: 0, lost: [], trip, legFn, rules, settings, country, kb, pois });
  assert.deepEqual(next.plan.corridor.map((c) => [c.legIndex, c.pois.map((x) => x.poi.id)]), [[0, ['AB中', '近33']]]);
  const hint = next.plan.warnings.filter((w) => w.ruleId === 'leg-suggest');
  assert.deepEqual(hint.map((w) => [w.legIndex, w.walkMin]), [[0, 20]]);
  assert.equal(next.plan.applied, true);
  assert.deepEqual(appliedPlan({ planned, sequence, appliedIndex: 0, lost: [], trip, legFn, rules, settings, country, kb }).plan.corridor, [], '舊呼叫端沒給 pois');
  // 給了 plans：別天引擎插的站不列（跟 planTrip 一樣）；同一天的舊序列不算
  const plans = { '2026-08-13': planned, '2026-08-14': { date: '2026-08-14', plan: { sequence: [{ poi: near, insertedBy: 'engine', priority: 'onway' }] } } };
  assert.deepEqual(appliedPlan({ planned, sequence, appliedIndex: 0, lost: [], trip, legFn, rules, settings, country, kb, pois, plans }).plan.corridor.map((c) => c.pois.map((x) => x.poi.id)), [['AB中']]);
});

test('shortName：點名用的短店名——括號、【】裡的研究註記拿掉、留一個空白；整個名字都是括號就照原樣；corridorNames 用它', () => {
  assert.equal(shortName('味的牛舌 喜助 發祥店一番町店（老舖・米其林）'), '味的牛舌 喜助 發祥店一番町店');
  assert.equal(shortName('一番町拱廊商店街群（サンモール／ぶらんどーむ／一番町四丁目）'), '一番町拱廊商店街群');
  assert.equal(shortName('牛舌料理 閣（Kaku）布蘭多姆本店'), '牛舌料理 閣 布蘭多姆本店');
  assert.equal(shortName('味の牛たん 福助 本店（たんしゃぶ發祥）【待確認】'), '味の牛たん 福助 本店');
  assert.equal(shortName('darestore (Dare Store)'), 'darestore');
  assert.equal(shortName('（全是括號）'), '（全是括號）');
  assert.equal(shortName(null), '');
  assert.deepEqual(corridorNames([{ poi: { id: 'x', name_zh: 'X（註）' }, distM: 1 }], 3), { names: ['X'], more: 0 });
});

