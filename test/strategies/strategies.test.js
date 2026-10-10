// T6：五種改案策略各出一案，交給核心重排；用 8/13 下午落後的情境。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replanDay, STRATEGIES } from '../../src/strategies/index.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, DAY_0813 } from '../sendai/fixture.js';

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
