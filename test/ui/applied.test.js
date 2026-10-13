// 現場改案持久化（T12 對抗審查）：快照只存 poiId 與時刻，還原對回 POI；套用後整天重算（走過的前綴裡的主行程、午餐不再被當成沒排）；
// replanAll 後打包相同就還原、不同就丟掉並警告一行；他改了勾選就清掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { evaluateSequence } from '../../src/engine/sequence.js';
import { replanDay, TIRED_STRATEGIES } from '../../src/strategies/index.js';
import { remainingFrom, lostStops, snapshotPlan, restorePlan, mergeDropped, appliedPlan, restoreApplied, withoutApplied } from '../../src/ui/applied.js';
import { TEXT } from '../../src/ui/text.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, demoTrip } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const pois = Object.fromEntries(Object.values(POIS).map((p) => [p.id, p]));
const trip = demoTrip();
const ctx = { trip, legFn, rules, settings, country: COUNTRY, kb: KB };
const DATE = '2026-08-13';
const plansOf = () => Object.fromEntries(planTrip({ trip, pois, rules, settings, country: COUNTRY, kb: KB, legFn, restPool: Object.values(pois) }).days.map((d) => [d.date, d]));
const ids = (seq) => seq.map((s) => s.poi.id);

/** 情境：8/13 走到主行程（大崎八幡宮）之後那一站，15:00 按累了、套「回住宿」（剩下全砍）。 */
function applyEndDay(plans) {
  const planned = plans[DATE];
  const idx = ids(planned.plan.sequence).indexOf(planned.day.anchorPoiId) + 1;
  assert.ok(idx >= 1, '示範 8/13 主行程要在序列裡');
  const remaining = remainingFrom(planned.plan.sequence, idx);
  const { all } = replanDay({ day: planned.day, remaining, here: planned.plan.sequence[idx - 1].poi, nowMin: 15 * 60, rules, settings, country: COUNTRY, kb: KB, legFn, pool: [], strategies: TIRED_STRATEGIES });
  const proposal = all.find((p) => p.id === 'end-day');
  const sequence = [...planned.plan.sequence.slice(0, idx), ...proposal.plan.sequence];
  const lost = lostStops(proposal, remaining).map((l) => ({ poiId: l.poi.id, reason: l.reason }));
  const next = appliedPlan({ planned, sequence, appliedIndex: idx, lost, ...ctx });
  return { planned, next, idx, lost, remaining, proposal };
}

test('套用後整天重算：分數對走過的前綴＋改案算，主行程在前綴裡就不警告「主行程沒排進去」，plan.applied、day.resumed 標起來，排不進＝引擎的 ∪ 這案砍掉的', () => {
  const { planned, next, idx, lost, proposal } = applyEndDay(plansOf());
  assert.equal(next.plan.applied, true);
  assert.equal(next.day.resumed, true);
  assert.equal(next.date, DATE);
  assert.deepEqual(ids(next.plan.sequence), ids(planned.plan.sequence).slice(0, idx), '回住宿：只剩走過的前綴');
  assert.ok(next.plan.complete, '主行程在前綴裡，整天仍成立');
  assert.ok(!next.plan.warnings.some((w) => w.ruleId === 'anchor'));
  assert.ok(next.plan.score > proposal.plan.score, `整天的分數 ${next.plan.score} 要高於只算剩下的站的 ${proposal.plan.score}`);
  const ev = evaluateSequence({ sequence: next.plan.sequence, day: { ...planned.day, window: { ...planned.day.window, endMin: planned.day.windowRaw.endMin } }, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  assert.equal(next.plan.score, ev.score);
  assert.equal(next.plan.penaltyMin, ev.penaltyMin);
  // 砍掉的站都進 dropped、理由是策略寫的；引擎原本排不進的也還在；序列裡的不在
  assert.ok(lost.length >= 1);
  for (const l of lost) assert.equal(next.plan.dropped.find((d) => d.poi.id === l.poiId)?.reason, '今天到此為止');
  for (const d of planned.plan.dropped) assert.ok(next.plan.dropped.some((x) => x.poi.id === d.poi.id && x.reason === d.reason));
  assert.ok(next.plan.dropped.every((d) => !ids(next.plan.sequence).includes(d.poi.id)));
  assert.ok(!next.plan.dropped.some((d) => d.poi.id === planned.day.anchorPoiId));
  // 沒動傳進來的物件
  assert.equal(planned.plan.applied, undefined);
  assert.equal(planned.day.resumed, undefined);
});

test('快照只存 poiId 與時刻、旗標，過 JSON 再還原成同一條序列（POI 從 pois 對回）', () => {
  const { next, idx, lost } = applyEndDay(plansOf());
  const snap = JSON.parse(JSON.stringify(snapshotPlan(next.plan, idx, { packAt: '2026-10-12T09:20:39.809Z', lost })));
  assert.equal(snap.packAt, '2026-10-12T09:20:39.809Z');
  assert.equal(snap.appliedIndex, idx);
  assert.equal(snap.stops.length, next.plan.sequence.length);
  assert.ok(snap.stops.every((s) => typeof s.poiId === 'string' && s.poi === undefined), 'POI 本體不存');
  assert.deepEqual(snap.lost, lost);
  const restored = restorePlan(snap, pois);
  const strip = (s) => ({ id: s.poi.id, startMin: s.startMin, endMin: s.endMin, dwellMin: s.dwellMin, waitMin: s.waitMin, arriveMin: s.arriveMin, fixedWindow: s.fixedWindow ?? null, insertedBy: s.insertedBy ?? null, priority: s.priority, optional: Boolean(s.optional), gap: s.gap ?? null, isAnchor: Boolean(s.isAnchor), designated: Boolean(s.designated) });
  assert.deepEqual(restored.map(strip), next.plan.sequence.map(strip));
  assert.ok(restored.every((s) => s.poi === pois[s.poi.id]), '對回同一個 POI 物件');
  assert.deepEqual(restorePlan({ stops: [{ poiId: 'ghost', startMin: 0 }] }, pois), [], '知識庫裡沒有的站跳過');
  assert.deepEqual(restorePlan(null, pois), []);
});

test('restoreApplied：打包時間相同就把快照還原回那天的 plan（整天重算、applied 標起來），別天不動、傳進來的不改', () => {
  const first = plansOf();
  const { next, idx, lost } = applyEndDay(first);
  const applied = { [DATE]: JSON.parse(JSON.stringify(snapshotPlan(next.plan, idx, { packAt: 'p1', lost }))) };
  const fresh = plansOf();   // 任何 replanAll：改設定、換一家、重開
  const r = restoreApplied({ plans: fresh, applied, packAt: 'p1', pois, ...ctx });
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.applied, applied);
  assert.equal(r.plans[DATE].plan.applied, true);
  assert.equal(r.plans[DATE].day.resumed, true);
  assert.deepEqual(ids(r.plans[DATE].plan.sequence), ids(next.plan.sequence));
  assert.equal(r.plans[DATE].plan.score, next.plan.score);
  assert.equal(r.plans[DATE].plan.penaltyMin, next.plan.penaltyMin);
  assert.deepEqual(r.plans[DATE].plan.dropped.map((d) => [d.poi.id, d.reason]), next.plan.dropped.map((d) => [d.poi.id, d.reason]));
  assert.equal(r.plans['2026-08-17'], fresh['2026-08-17'], '別天原封不動');
  assert.equal(fresh[DATE].plan.applied, undefined, '傳進來的 plans 沒被改');
});

test('restoreApplied：打包時間不同（手機更新了新打包）就丟掉那筆、那天多一行警告、序列是引擎的；日期不在這趟的也丟、不警告', () => {
  const first = plansOf();
  const { next, idx, lost } = applyEndDay(first);
  const applied = { [DATE]: snapshotPlan(next.plan, idx, { packAt: 'p1', lost }), '2025-01-01': snapshotPlan(next.plan, 0, { packAt: 'p2' }) };
  const fresh = plansOf();
  const r = restoreApplied({ plans: fresh, applied, packAt: 'p2', pois, ...ctx });
  assert.deepEqual(r.dropped.sort(), [DATE, '2025-01-01'].sort());
  assert.deepEqual(r.applied, {});
  assert.equal(r.plans[DATE].plan.applied, undefined);
  assert.deepEqual(ids(r.plans[DATE].plan.sequence), ids(fresh[DATE].plan.sequence));
  assert.ok(r.plans[DATE].plan.warnings.some((w) => w.code === 'applied-dropped' && w.msg === TEXT.appliedDropped));
  assert.equal(r.plans[DATE].plan.warnings.filter((w) => w.code === 'applied-dropped').length, 1);
  assert.equal(fresh[DATE].plan.warnings.some((w) => w.code === 'applied-dropped'), false, '傳進來的 plan 沒被改');
  // 示範旅程沒有打包（packAt null）：null 對 null 算相同
  const demo = restoreApplied({ plans: plansOf(), applied: { [DATE]: snapshotPlan(next.plan, idx, { packAt: null, lost }) }, packAt: null, pois, ...ctx });
  assert.equal(demo.plans[DATE].plan.applied, true);
  // 沒有快照：什麼都不做
  const none = restoreApplied({ plans: fresh, applied: undefined, packAt: 'p2', pois, ...ctx });
  assert.deepEqual(none.dropped, []);
  assert.equal(none.plans[DATE], fresh[DATE]);
});

test('withoutApplied：他改了那天的勾選就清掉那天的快照；沒有那天的就回原物件（呼叫端比 identity 決定要不要存）', () => {
  const applied = { [DATE]: { packAt: 'p1', stops: [] }, '2026-08-17': { packAt: 'p1', stops: [] } };
  const r = withoutApplied(applied, DATE);
  assert.deepEqual(Object.keys(r), ['2026-08-17']);
  assert.deepEqual(Object.keys(applied), [DATE, '2026-08-17'], '不改原物件');
  assert.equal(withoutApplied(applied, '2026-08-15'), applied);
  assert.equal(withoutApplied(undefined, DATE), undefined);
});

test('mergeDropped：引擎的 dropped ∪ 引擎排了但序列裡沒有的（他勾的）；理由先用這案記的；引擎插的站與序列裡的不列', () => {
  const p = (id) => ({ id, name_zh: id });
  const engine = {
    dropped: [{ poi: p('x'), priority: 'maybe', reason: '引擎的理由' }, { poi: p('w'), priority: 'want', reason: '引擎的理由 w' }],
    sequence: [{ poi: p('a'), priority: 'must' }, { poi: p('b'), priority: 'want' }, { poi: p('r'), priority: 'rest', optional: true, insertedBy: 'engine' }],
  };
  const out = mergeDropped({ engine, sequence: [{ poi: p('a') }], lost: [{ poiId: 'b', reason: '今天到此為止' }, { poiId: 'w', reason: '要走路的站' }] });
  assert.deepEqual(out.map((d) => [d.poi.id, d.priority, d.reason]), [['x', 'maybe', '引擎的理由'], ['w', 'want', '要走路的站'], ['b', 'want', '今天到此為止']]);
  const noReason = mergeDropped({ engine, sequence: [{ poi: p('a') }] });
  assert.equal(noReason.find((d) => d.poi.id === 'b').reason, TEXT.appliedLost);
});

test('lostStops：這案沒排進的他勾的站（引擎插的不算），理由先用核心排不進的那句、再用策略砍的 why', () => {
  const p = (id) => ({ id, name_zh: id });
  const remaining = [{ poi: p('a'), priority: 'want' }, { poi: p('b'), priority: 'want' }, { poi: p('c'), priority: 'maybe' }, { poi: p('r'), priority: 'rest', insertedBy: 'engine' }];
  const proposal = { plan: { sequence: [{ poi: p('a') }], dropped: [{ poi: p('c'), reason: '時間或分數排不進' }] }, changes: [{ poiId: 'b', action: 'cut', why: '要走路的站' }, { poiId: 'c', action: 'cut', why: '要走路的站' }] };
  assert.deepEqual(lostStops(proposal, remaining).map((l) => [l.poi.id, l.reason]), [['b', '要走路的站'], ['c', '時間或分數排不進']]);
});
