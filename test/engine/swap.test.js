// 換這一站：同類型、順路、那時段有開；餐段放寬到所有吃的類；換掉的記在 day.swapped 不算落選。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapCandidates, applySwap } from '../../src/engine/swap.js';
import { planDay } from '../../src/engine/core.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, DAY_0817, CANDS_0817 } from '../sendai/fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;

test('8/17 把 me 換掉：候選是同區順路、當時有開的古著店；換成 SQUAT 後 picks 更新、swapped 有紀錄', () => {
  const plan = planDay({ candidates: CANDS_0817, day: DAY_0817, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  const me = plan.sequence.find((s) => s.poi.id === POIS.me.id);
  assert.ok(me, '夾具裡 me 會被排進去');
  const pool = Object.values(POIS).map((poi) => ({ poi }));
  const cands = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings });
  const names = cands.map((c) => c.poi.name_zh);
  assert.ok(names.length >= 1 && cands.every((c) => c.poi.category === 'vintage'), `要是同類型：${names.join('、')}`);
  assert.ok(!names.includes('Utah'), '已經在行程裡的不列');
  assert.ok(!names.includes('星山珈琲店'), '不同類型不列');
  assert.ok(cands.every((c) => c.detourMin <= (settings.swapDetourMaxMin ?? 10)), '預設門檻內');
  // 門檻放到夠寬：列出來的還是只有沒排進去的同類店；縮到比最小繞路還小：一家都不列（不綁死順序，引擎改排法測試也成立）
  const wide = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings: { ...settings, swapDetourMaxMin: 999 } });
  assert.ok(wide.length >= cands.length && wide.every((c) => c.poi.category === 'vintage' && !plan.sequence.some((s) => s.poi.id === c.poi.id)), '放寬後仍是沒排進的古著店');
  const minDetour = Math.min(...wide.map((c) => c.detourMin));
  const narrow = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings: { ...settings, swapDetourMaxMin: minDetour - 1 } });
  assert.equal(narrow.length, 0, '門檻比最小繞路還小就沒有候選');
  const day = applySwap({ date: DAY_0817.date, picks: CANDS_0817.map((c) => ({ poiId: c.poi.id, priority: c.priority })) }, POIS.me.id, POIS.SQUAT);
  assert.ok(day.picks.some((p) => p.poiId === POIS.SQUAT.id) && !day.picks.some((p) => p.poiId === POIS.me.id));
  assert.equal(day.swapped[0].from, POIS.me.id);
});

test('餐段的站放寬到所有吃的類；沒開的不列', () => {
  const plan = planDay({ candidates: CANDS_0817, day: DAY_0817, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  const pool = Object.values(POIS).map((poi) => ({ poi }));
  const cands = swapCandidates({ plan, stopId: POIS['おやま'].id, pool, legFn, date: DAY_0817.date, settings });
  const names = cands.map((c) => c.poi.name_zh);
  assert.ok(names.includes('星山珈琲店') || names.includes('喫茶 Elbe') || names.includes('たん焼き一隆'), `吃的類要能互換：${names.join('、')}`);
  assert.ok(!names.includes('Utah'));
});

test('在場的人不想去的店型（day.adjust，T19）：餐段放寬進來的別類不列（他勾的食堂不列同行者不去的咖啡廳、酒吧）；跟這一站同 category 的照列（他勾的那一類由他）；沒 adjust 照舊', () => {
  const plan = planDay({ candidates: CANDS_0817, day: DAY_0817, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  const pool = Object.values(POIS).map((poi) => ({ poi }));
  const catOf = (id) => Object.values(POIS).find((p) => p.id === id)?.category;
  const base = { plan, stopId: POIS['おやま'].id, pool, legFn, date: DAY_0817.date, settings: { ...settings, swapDetourMaxMin: 999 } };
  const plain = swapCandidates(base).map((c) => c.poi.id);
  assert.ok(plain.some((id) => catOf(id) === 'cafe'), `對照組要有咖啡廳：${plain.join('、')}`);
  const avoid = (list) => ({ stamina: 'normal', nightSlot: 'default', avoidCategories: list, avoidBy: {} });
  const noCafe = swapCandidates({ ...base, adjust: avoid(['cafe', 'bar']) }).map((c) => c.poi.id);
  assert.ok(noCafe.length > 0 && noCafe.every((id) => catOf(id) === 'food'), `只剩吃的：${noCafe.join('、')}`);
  assert.deepEqual(noCafe, plain.filter((id) => catOf(id) === 'food'), '吃的那幾家一家不少');
  assert.deepEqual(swapCandidates({ ...base, adjust: avoid(['food']) }).map((c) => c.poi.id), plain, '同行者不去食堂、但這一站就是他勾的食堂：同類照列，候選跟沒 adjust 一樣');
  assert.deepEqual(swapCandidates({ ...base, adjust: undefined }).map((c) => c.poi.id), plain);
});
