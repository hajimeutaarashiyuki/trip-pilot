// T6：五種改案策略各出一案，交給核心重排；用 8/13 下午落後的情境。T12：「累了／腳痛」只跑降速那組（TIRED_STRATEGIES）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replanDay, STRATEGIES, TIRED_STRATEGIES } from '../../src/strategies/index.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, DAY_0813, DAY_0817 } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;

// 情境：15:00 在 Elbe 門口，落後 40 分；還沒去：護國神社（指定）、一隆（晚餐）、阿武隈書房、ディスクノート、汐谷
const here = POIS['喫茶 Elbe'];
const remaining = [
  { poi: { ...POIS['宮城縣護國神社'], alternatives: [POIS['大崎八幡宮'].id] }, priority: 'must', designated: true },
  { poi: POIS['たん焼き一隆'], priority: 'want' },
  { poi: { ...POIS['阿武隈書房'], otherDaysOpen: ['2026-08-15'] }, priority: 'maybe' },
  { poi: { ...POIS['ディスクノート'], otherDaysOpen: ['2026-08-17'] }, priority: 'maybe' },
  { poi: POIS['汐谷'], priority: 'want' },
];
const pool = [{ poi: POIS['珈巣多夢'] }, { poi: POIS['火星の庭'] }, { poi: POIS['星山珈琲店'] }];
const day = { ...DAY_0813, anchorPoiId: null, designated: [POIS['宮城縣護國神社'].id] };
const input = { day, remaining, here, nowMin: 15 * 60, rules, settings, country: COUNTRY, kb: KB, legFn, pool };

test('五種策略各跑一次、去重後依分數排、最多回三案，每案都排得出東西', () => {
  const { proposals, all } = replanDay(input);
  assert.ok(all.length >= 4, `出案數 ${all.length}`);
  assert.ok(proposals.length >= 1 && proposals.length <= 3);
  for (const p of all) {
    assert.ok(Array.isArray(p.plan.sequence));
    assert.ok(typeof p.note === 'string' && p.note.length > 0);
    for (const s of p.plan.sequence) assert.ok(s.startMin >= 15 * 60, `${p.id}：${s.poi.name_zh} 不能排在現在之前`);
  }
  assert.ok(proposals.every((p, i, a) => i === 0 || a[i - 1].plan.score >= p.plan.score), '要依分數排');
});

test('壓縮只縮非指定站；降速先插最近的恢復站再砍要走路的站並把逛店上限減半；移到別天拿走 maybe', () => {
  const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
  const c = byId.compress.apply(input);
  assert.ok(c.changes.length > 0);
  assert.equal(c.candidates.find((x) => x.poi.id === POIS['宮城縣護國神社'].id).dwellMin, undefined, '指定站不縮');
  assert.equal(c.candidates.find((x) => x.poi.id === POIS['汐谷'].id).dwellMin, 70, '90 → 70（×0.75 取 5 的倍數）');

  const s = byId['slow-down'].apply(input);
  assert.equal(s.candidates[0].insertedBy, 'engine');
  assert.ok(s.candidates[0].poi.recovery, '插進來的是恢復站');
  assert.ok(!s.candidates.some((x) => x.poi.id === POIS['宮城縣護國神社'].id && x.priority !== 'must'));
  assert.equal(s.settingsPatch.maxShopRunCount, 2);

  const m = byId['move-day'].apply(input);
  assert.ok(m.changes.every((ch) => ch.toDays.length > 0));
  assert.ok(m.candidates.length < remaining.length);
  assert.ok(m.candidates.some((x) => x.poi.id === POIS['宮城縣護國神社'].id), '指定站不挪');

  const w = byId['swap-alt'].apply(input);
  assert.equal(w, null, '最遠的站是指定站（must）不換；其他沒有備案 → 不出案');
});

test('累了／腳痛只跑降速那組：至少一案；插的恢復站標引擎插的、釘在現在出發就到的時刻排最前面；回住宿那案是空的、分數最低排最後', () => {
  const { proposals, all } = replanDay({ ...input, strategies: TIRED_STRATEGIES });
  assert.ok(proposals.length >= 1 && proposals.length <= 3, `回 ${proposals.length} 案`);
  const withRest = all.filter((p) => p.plan.sequence.some((s) => s.insertedBy === 'engine' && s.poi.recovery));
  assert.ok(withRest.length >= 1, '要有含引擎插的恢復站的案');
  for (const p of withRest) {
    const first = p.plan.sequence[0];
    assert.equal(first.insertedBy, 'engine', `${p.id}：恢復站要排在最前面（先坐一下）：${p.plan.sequence.map((s) => s.poi.name_zh).join('→')}`);
    assert.equal(first.startMin, 15 * 60 + 8, '15:00 從 Elbe 走 8 分就到、不等');
    assert.equal(first.waitMin, 0);
    assert.equal(first.optional, true, '排不進不算落選');
    assert.equal(first.priority, 'want', '他按了累了，這站是要的（價值不是 0）');
    assert.ok(p.changes.some((c) => c.action === 'insert-rest' && c.poiId === first.poi.id));
  }
  const end = all.find((p) => p.id === 'end-day');
  assert.deepEqual(end.plan.sequence, []);
  assert.ok(end.changes.length === remaining.length && end.changes.every((c) => c.action === 'cut'), '回住宿：剩下的全記成砍掉，畫面才寫得出少掉什麼');
  assert.equal(proposals[proposals.length - 1].id, 'end-day', '回住宿分數最低、排最後');

  // 17:00：一隆（6 分）、汐谷（8 分）都開了 → 不插新的，最近的一隆釘到最前面（先坐一下）；只坐一下那案不出
  const later = replanDay({ ...input, nowMin: 17 * 60, strategies: TIRED_STRATEGIES });
  assert.ok(!later.all.some((p) => p.id === 'rest-only'));
  const slow = later.all.find((p) => p.id === 'slow-down');
  assert.equal(slow.plan.sequence[0].poi.id, POIS['たん焼き一隆'].id, `先坐一下要是真的先：${slow.plan.sequence.map((s) => s.poi.name_zh).join('→')}`);
  assert.equal(slow.plan.sequence[0].startMin, 17 * 60 + 6);
  assert.deepEqual(slow.plan.sequence[0].fixedWindow, { startMin: 17 * 60 + 6, pinned: true }, '釘的時刻帶 pinned，現場頁再重排時會拿掉');
  assert.ok(!slow.changes.some((c) => c.action === 'insert-rest'));
});

test('只坐一下：剩下的站裡 30 分內有恢復站進得去就不出案；挑的恢復站要在到達時有開、待得完', () => {
  const restOnly = TIRED_STRATEGIES.find((s) => s.id === 'rest-only');
  // 15:00：一隆、汐谷都 17:00 才開 → 沒有 30 分內進得去的恢復站 → 插最近的咖啡廳，其他站都留著
  const r = restOnly.apply(input);
  assert.ok(r && r.candidates[0].insertedBy === 'engine' && r.candidates[0].poi.cafeLike);
  assert.equal(r.candidates.length, remaining.length + 1, '站都留著');
  assert.deepEqual(r.candidates[0].fixedWindow, { startMin: 15 * 60 + 8, pinned: true });
  // 17:00：汐谷開了 → 30 分內有恢復站 → 不出案
  assert.equal(restOnly.apply({ ...input, nowMin: 17 * 60 }), null);
  // 19:00、剩下的沒有恢復站、pool 只有 18:00 就關的火星の庭 → 到了沒開 → 挑不到、不出案
  assert.equal(restOnly.apply({ ...input, nowMin: 19 * 60, remaining: remaining.filter((c) => !c.poi.recovery), pool: [{ poi: POIS['火星の庭'] }] }), null);
});

// T12 對抗審查後補：改案用原時窗（吃留白）、跟目前剩下一模一樣的案不出、降速縮步行
const BAR = POIS['文化横丁 小酒場'];   // 17:00–24:00、待 90
const lateDay = { ...DAY_0817, anchorPoiId: null, designated: [], window: { startMin: 11 * 60, endMin: 22 * 60 + 30 }, windowRaw: { startMin: 11 * 60, endMin: 24 * 60 }, openSlotMin: 90 };
const lateInput = { ...input, day: lateDay, remaining: [{ poi: BAR, priority: 'want' }], here: POIS['TRUE VINTAGE'], nowMin: 21 * 60 + 5, pool: [], strategies: TIRED_STRATEGIES };

test('改案的收工用原時窗（留白是給現場落後吃的）：8/17 21:05 剩 bar，降速那案 21:13–22:43 排得進、記吃掉留白 13 分；回住宿那案 0；沒有原時窗就照扣過的收工', () => {
  const { proposals, all } = replanDay(lateInput);
  const slow = all.find((p) => p.id === 'slow-down');
  assert.ok(slow, '降速那案要出');
  assert.deepEqual(slow.plan.sequence.map((s) => [s.poi.id, s.startMin, s.endMin]), [[BAR.id, 21 * 60 + 13, 22 * 60 + 43]], '21:05 走 8 分到、待 90、超過扣過留白的收工 22:30 也排得進');
  assert.equal(slow.eatsSlackMin, 13);
  assert.ok(!slow.plan.warnings.some((w) => w.ruleId === 'window'), '原時窗 24:00 內，沒有超過收工的警告');
  assert.equal(all.find((p) => p.id === 'end-day').eatsSlackMin, 0);
  assert.ok(proposals.some((p) => p.id === 'slow-down'), `清單裡要有降速：${proposals.map((p) => p.id).join('、')}`);
  // 對照：沒有 windowRaw 的 day（舊形狀）就照 window.endMin 收工，bar 排不進
  const { all: strict } = replanDay({ ...lateInput, day: { ...lateDay, windowRaw: undefined } });
  assert.deepEqual(strict.find((p) => p.id === 'slow-down').plan.sequence, []);
  assert.ok(strict.find((p) => p.id === 'slow-down').plan.dropped.some((d) => d.poi.id === BAR.id && /收工時間 22:30/.test(d.reason)));
});

test('跟目前剩下的排程一模一樣的案不出（逐站 poiId＋startMin）；remaining 沒帶 startMin 或時刻不同就照出；all 不過濾', () => {
  const base = { ...input, remaining: [{ poi: POIS['たん焼き一隆'], priority: 'want' }], nowMin: 17 * 60, pool: [], strategies: TIRED_STRATEGIES };
  const open = replanDay(base);
  const slow = open.all.find((p) => p.id === 'slow-down');
  assert.deepEqual(slow.plan.sequence.map((s) => [s.poi.id, s.startMin]), [[POIS['たん焼き一隆'].id, 17 * 60 + 6]]);
  assert.ok(open.proposals.some((p) => p.id === 'slow-down'), 'remaining 沒帶時刻：照出');
  const same = replanDay({ ...base, remaining: [{ poi: POIS['たん焼き一隆'], priority: 'want', startMin: 17 * 60 + 6 }] });
  assert.ok(!same.proposals.some((p) => p.id === 'slow-down'), '序列與時刻都跟現在一樣：不出');
  assert.ok(same.all.some((p) => p.id === 'slow-down'), 'all 留著給測試看');
  assert.ok(same.proposals.some((p) => p.id === 'end-day'), '不一樣的案（回住宿）還在');
  const shifted = replanDay({ ...base, remaining: [{ poi: POIS['たん焼き一隆'], priority: 'want', startMin: 17 * 60 + 30 }] });
  assert.ok(shifted.proposals.some((p) => p.id === 'slow-down'), '同一站但時刻不同：照出');
});

test('降速縮步行：走路上限乘 slowDownWalkFactor（150 × 0.7 → 105），一句話寫出來；rules.json 有這個數字', () => {
  assert.equal(settings.slowDownWalkFactor, 0.7);
  const s = TIRED_STRATEGIES.find((x) => x.id === 'slow-down').apply(input);
  assert.equal(s.settingsPatch.walkBudgetMin, 105);
  assert.match(s.note, /走路上限降到 105 分$/);
  const custom = TIRED_STRATEGIES.find((x) => x.id === 'slow-down').apply({ ...input, settings: { ...settings, walkBudgetMin: 200, slowDownWalkFactor: 0.5 } });
  assert.equal(custom.settingsPatch.walkBudgetMin, 100);
});
