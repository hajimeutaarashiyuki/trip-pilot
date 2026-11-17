// T4 驗收（計畫 1b）：8/13 與 8/17 各一秒內出解，結果要對得上 e2e-v4 審查的結論與 10-09 的規則。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay } from '../../src/engine/core.js';
import { planTrip } from '../../src/engine/trip.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import { servesMeal } from '../../src/rules/_slots.js';
import { minToHm } from '../../src/engine/time.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };
import { POIS, HOME, KB, COUNTRY, legFn, DAY_0813, DAY_0817, CANDS_0813, CANDS_0817, demoTrip } from './fixture.js';

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const show = (r) => r.sequence.map((s) => `${minToHm(s.startMin)} ${s.poi.name_zh}`).join(' → ');

// 能當哪一餐（11-06 第二批；原話 #195）：咖啡廳、酒吧不再自動算一餐，要知識庫標 meals 或店型原文看得出是酒場型。8/13 的晚餐是汐谷（有飯的日本酒小店）、
// 8/17 的晚餐是文化横丁的小酒場——示範資料（src/demo/sendai.js）11-17 照知識庫那兩筆補了 meals（之前只寫店型鍵，載入示範兩天都多一句「今天沒排晚餐」）。
// Elbe 是午晚都有正餐的洋食喫茶，知識庫 11-06 標了、示範資料沒標：這裡補上同樣的標註再排，確認標不標那一天排出來都一樣（下面第二條）。
const MEALS_0813 = { '喫茶 Elbe': { lunch: '鹽味義大利麵、拿坡里、蛋包飯', dinner: '鹽味義大利麵、拿坡里、蛋包飯' } };
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

test('示範資料原樣（11-17 補了汐谷與文化横丁小酒場的 meals）：兩天的午餐晚餐都有著落、沒有「今天沒排晚餐」；Elbe 標不標 8/13 排出來都一樣；照畫面「載入示範」整趟排也一樣；示範的國家層沒有早餐段', () => {
  const args = { day: DAY_0813, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB };
  const raw = planDay({ ...args, candidates: CANDS_0813 });
  const marked = planDay({ ...args, candidates: withMeals(CANDS_0813) });
  assert.deepEqual(raw.sequence.map((s) => s.poi.name_zh), marked.sequence.map((s) => s.poi.name_zh), `Elbe 標不標排出來的順序一樣：${show(raw)}`);
  assert.deepEqual(raw.warnings.filter((w) => w.ruleId === 'meal-slots'), [], `8/13 原樣的示範資料：晚餐是汐谷、午餐是一隆（${show(raw)}）`);
  assert.equal(marked.score, raw.score, 'Elbe 標不標同分');
  const d17 = planDay({ candidates: CANDS_0817, day: DAY_0817, home: HOME, legFn, rules, settings, country: COUNTRY, kb: KB });
  assert.deepEqual(d17.warnings.filter((w) => w.ruleId === 'meal-slots'), [], `8/17 原樣的示範資料：晚餐是文化横丁的小酒場（${show(d17)}）`);
  // 這兩筆的 meals 就是知識庫那兩筆的標註（只講供應什麼）；其餘的站照店型推導
  assert.deepEqual(POIS['汐谷'].meals, { dinner: '魟魚肝刺身、薑絲鮮魚捲這類魚料理，配日本酒' });
  assert.deepEqual(POIS['文化横丁 小酒場'].meals, { dinner: '橫丁小店一家吃一點，煎餃、和食小菜、鄉土菜配地酒' });
  assert.deepEqual([servesMeal(POIS['汐谷'], 'lunch'), servesMeal(POIS['バンザイ'], 'dinner'), servesMeal(POIS['喫茶 Elbe'], 'dinner'), servesMeal(POIS['たん焼き一隆'], 'dinner')], [false, false, false, true]);
  // 照畫面「載入示範」的做法整趟排（ui/app.js loadDemo：demoTrip、整份示範 POI 當引擎可插的站）：兩天都沒有餐段的黃字，plan.meals 的晚餐就是那兩家
  const r = planTrip({ trip: demoTrip(), pois: Object.fromEntries(Object.values(POIS).map((p) => [p.id, p])), rules, settings, country: COUNTRY, kb: KB, legFn, restPool: Object.values(POIS) });
  assert.deepEqual(r.days.map((d) => d.plan.warnings.filter((w) => w.ruleId === 'meal-slots').map((w) => w.msg)), [[], []]);
  assert.deepEqual(r.days.map((d) => d.plan.meals.dinner), [POIS['汐谷'].id, POIS['文化横丁 小酒場'].id]);
  // 示範旅程的國家層現況：只有午餐、晚餐兩段，沒有早餐段——載入示範不排早餐、沒有早餐卡（這一批照現況不動）
  assert.deepEqual(Object.keys(COUNTRY.mealSlots), ['lunch', 'dinner']);
  assert.deepEqual(r.days.map((d) => d.plan.meals.breakfast), [null, null]);
  assert.ok(r.days.every((d) => !d.plan.warnings.some((w) => w.ruleId === 'breakfast-slot')));
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
