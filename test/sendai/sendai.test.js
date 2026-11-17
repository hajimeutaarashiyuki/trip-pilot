// T4 驗收（計畫 1b）：8/13 與 8/17 各一秒內出解，結果要對得上 e2e-v4 審查的結論與 10-09 的規則。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay } from '../../src/engine/core.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { minToHm } from '../../src/engine/time.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, DAY_0813, DAY_0817, CANDS_0813, CANDS_0817 } from './fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const show = (r) => r.sequence.map((s) => `${minToHm(s.startMin)} ${s.poi.name_zh}`).join(' → ');

// 能當哪一餐（11-06 第二批；原話 #195）：咖啡廳、酒吧不再自動算一餐，要知識庫標 meals 或店型原文看得出是酒場型。8/13 的晚餐是汐谷（有飯的日本酒小店）、
// Elbe 是午晚都有正餐的洋食喫茶——知識庫那兩筆 11-06 標了；示範資料（src/demo/sendai.js）只寫店型鍵、還沒標，這裡補上同樣的標註再排。原樣的示範資料另外驗（下一條）。
const MEALS_0813 = { '汐谷': { dinner: '魚料理配日本酒，吃得成一頓晚餐' }, '喫茶 Elbe': { lunch: '鹽味義大利麵、拿坡里、蛋包飯', dinner: '鹽味義大利麵、拿坡里、蛋包飯' } };
const withMeals = (cands) => cands.map((c) => (MEALS_0813[c.poi.name_zh] ? { ...c, poi: { ...c.poi, meals: MEALS_0813[c.poi.name_zh] } } : c));

test('8/13 市區古蹟神社日：主行程與指定站都在、午晚餐有、咖啡廳不連排且最多兩家、一秒內', () => {
  const r = planDay({ candidates: withMeals(CANDS_0813), day: DAY_0813, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB, options: { explain: true } });
  const ids = r.sequence.map((s) => s.poi.name_zh);
  assert.ok(r.complete, `主行程沒排進：${show(r)}`);
  assert.ok(ids.includes('大崎八幡宮') && ids.includes('宮城縣護國神社'), show(r));
  assert.ok(!r.warnings.some((w) => w.ruleId === 'designated'), '指定站都要在');
  assert.ok(!r.warnings.some((w) => w.ruleId === 'cafe-adjacent'), `咖啡廳不該連排：${show(r)}`);
  const cafes = r.sequence.filter((s) => s.poi.cafeLike).length;
  assert.ok(cafes <= settings.sameTypeMaxPerDay, `非主題日咖啡廳最多 ${settings.sameTypeMaxPerDay} 家，排了 ${cafes}`);
  assert.ok(!r.warnings.some((w) => w.ruleId === 'meal-slots'), `午晚餐要有：${show(r)}`);
  for (const s of r.sequence) assert.ok(!r.warnings.some((w) => w.ruleId === 'hours' && w.poiId === s.poi.id), `${s.poi.name_zh} 要在營業時間內`);
  assert.ok(r.stats.ms < 1000, `花了 ${r.stats.ms} ms、${r.stats.nodes} 節點`);
  console.log(`8/13 ${show(r)} ｜ 分數 ${Math.round(r.score)}、罰 ${Math.round(r.penaltyMin)} 分、${r.stats.nodes} 節點 ${r.stats.ms} ms、丟 ${r.dropped.map((d) => d.poi.name_zh).join('、') || '無'}`);
});

test('8/13 示範資料原樣（汐谷、Elbe 都沒標能當哪一餐）：排出來的序列一樣，午餐有、晚餐算缺，多一句「今天沒排晚餐」——示範資料補了 meals 之後這一條要跟著改', () => {
  const args = { day: DAY_0813, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB };
  const raw = planDay({ ...args, candidates: CANDS_0813 });
  const marked = planDay({ ...args, candidates: withMeals(CANDS_0813) });
  assert.deepEqual(raw.sequence.map((s) => s.poi.name_zh), marked.sequence.map((s) => s.poi.name_zh), `標不標排出來的順序一樣：${show(raw)}`);
  assert.deepEqual(raw.warnings.filter((w) => w.ruleId === 'meal-slots').map((w) => w.msg), ['今天沒排晚餐'], '沒標的酒吧與咖啡廳不算晚餐（午餐是一隆，照算）');
  assert.equal(Math.round(marked.score - raw.score), 20, '差的就是缺一餐的 20 分');
});

test('8/17 古著主題日：おやま、Utah、バンザイ都在，古著 ≥3 家，逛店連跑不超，走路遠低於預算，一秒內', () => {
  const r = planDay({ candidates: CANDS_0817, day: DAY_0817, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB, options: { explain: true } });
  const ids = r.sequence.map((s) => s.poi.name_zh);
  assert.ok(r.complete, show(r));
  for (const must of ['おやま', 'Utah', 'バンザイ']) assert.ok(ids.includes(must), `${must} 要在：${show(r)}`);
  const vintage = r.sequence.filter((s) => s.poi.category === 'vintage').length;
  assert.ok(vintage >= 3, `古著主題日至少三家，排了 ${vintage}：${show(r)}`);
  assert.ok(!r.warnings.some((w) => w.ruleId === 'shop-run'), '逛店連跑不該超');
  assert.ok(!r.warnings.some((w) => w.ruleId === 'walk-budget'), '走路不該超預算');
  const banzai = r.sequence.find((s) => s.poi.name_zh === 'バンザイ');
  assert.ok(banzai.startMin >= 17 * 60, 'バンザイ 17:00 才開');
  assert.ok(r.stats.ms < 1000, `花了 ${r.stats.ms} ms、${r.stats.nodes} 節點`);
  console.log(`8/17 ${show(r)} ｜ 分數 ${Math.round(r.score)}、罰 ${Math.round(r.penaltyMin)} 分、${r.stats.nodes} 節點 ${r.stats.ms} ms、丟 ${r.dropped.map((d) => d.poi.name_zh).join('、') || '無'}`);
});
