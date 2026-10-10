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
  assert.ok(cands.every((c) => c.detourMin <= (settings.swapDetourMaxMin ?? 10)));
  // SQUAT 從松本清過去要多繞 11 分，預設 10 分不列；門檻放寬到 15 就列
  assert.ok(!names.includes('SQUAT'));
  const wider = swapCandidates({ plan, stopId: POIS.me.id, pool, legFn, date: DAY_0817.date, settings: { ...settings, swapDetourMaxMin: 15 } });
  assert.ok(wider.some((c) => c.poi.name_zh === 'SQUAT'));
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
