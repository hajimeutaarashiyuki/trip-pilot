// T2 驗收：三種介面各一條假規則；weight 0 停用；覆寫參數；缺欄位跳過並警告；壞規則載入期就炸。
// 規則讀自己的參數用 ctx.params（引擎注入），不用自己去找註冊表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRules, validateRule } from '../../src/rules/index.js';
import { emptyAcc } from '../../src/engine/dims.js';
import { evaluateStop, evaluateDay } from '../../src/engine/evaluate.js';

const walkDim = {
  id: 'walk', kind: 'dimension', reads: ['stop.poi.walkFactor', 'stop.dwellMin', 'leg.walkMin'],
  defaults: { initial: 0 },
  apply: (ctx) => ctx.acc.walk + ctx.leg.walkMin + ctx.stop.dwellMin * ctx.stop.poi.walkFactor,
};
const budgetSoft = {
  id: 'walk-budget', kind: 'soft', reads: ['acc.walk'], defaults: { maxMin: 150 },
  apply: (ctx) => Math.max(0, ctx.acc.walk - ctx.params.maxMin),
  warn: (ctx) => `今天走路 ${ctx.acc.walk} 分，超過 ${ctx.params.maxMin}`,
};
const hoursHard = {
  id: 'hours', kind: 'hard', reads: ['stop.poi.hours', 'stop.start'], defaults: {},
  apply: (ctx) => (ctx.stop.start >= ctx.stop.poi.hours.open ? 'ok' : 'no'),
  warn: () => '還沒開門',
};
const mealDay = {
  id: 'meal', kind: 'soft', scope: 'day', reads: ['sequence'], defaults: { missMin: 20 },
  apply: (ctx) => (ctx.sequence.some((s) => s.poi.recovery) ? 0 : ctx.params.missMin),
  warn: () => '今天沒有坐下來吃的站',
};
const baseCtx = (rules, stop, leg = { walkMin: 50 }) => ({ day: {}, prev: null, next: null, settings: {}, stop, leg, acc: emptyAcc(rules.dims) });

test('三種介面各一條：累積、硬約束、軟罰款，結果形狀正確', () => {
  const rules = loadRules([walkDim, budgetSoft, hoursHard, mealDay], { 'walk-budget': { maxMin: 100 } });
  assert.deepEqual(rules.disabled, []);
  assert.equal(rules.byId.get('walk-budget').params.maxMin, 100);
  const stop = { poi: { id: 'a', walkFactor: 1, hours: { open: 9 }, recovery: false }, dwellMin: 60, start: 10 };
  const r = evaluateStop(baseCtx(rules, stop), rules);
  assert.equal(r.acc.walk, 110);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.penaltyMin, 10);
  assert.deepEqual(r.breakdown.map((b) => b.ruleId), ['walk-budget']);
  assert.ok(r.warnings.some((w) => w.ruleId === 'walk-budget' && w.msg === '今天走路 110 分，超過 100'));

  const closed = evaluateStop(baseCtx(rules, { ...stop, start: 8 }), rules);
  assert.equal(closed.verdict, 'no');
  assert.ok(closed.warnings.some((w) => w.code === 'hard' && w.msg === '還沒開門'));

  const day = evaluateDay({ sequence: [stop], acc: r.acc, settings: {} }, rules);
  assert.equal(day.penaltyMin, 20);
  assert.equal(day.warnings[0].msg, '今天沒有坐下來吃的站');
});

test('weight 0 整條停用；weight 乘進罰款', () => {
  const rules = loadRules([walkDim, budgetSoft, hoursHard], { hours: { weight: 0 }, 'walk-budget': { weight: 2, maxMin: 100 } });
  assert.deepEqual(rules.disabled, ['hours']);
  assert.equal(rules.hard.length, 0);
  const r = evaluateStop(baseCtx(rules, { poi: { walkFactor: 1 }, dwellMin: 60, start: 8 }), rules);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.penaltyMin, 20);
});

test('缺欄位的規則對那站跳過並警告，其他規則照跑；規則丟例外也只是跳過', () => {
  const boom = { id: 'boom', kind: 'soft', reads: [], defaults: {}, apply: () => { throw new Error('壞掉'); } };
  const rules = loadRules([walkDim, budgetSoft, hoursHard, boom]);
  const r = evaluateStop(baseCtx(rules, { poi: { id: 'x', walkFactor: 0, hours: null }, dwellMin: 60, start: 10 }, { walkMin: 30 }), rules);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.acc.walk, 30);
  const skipped = r.warnings.filter((w) => w.code === 'skipped-missing');
  assert.deepEqual(skipped.map((w) => w.ruleId), ['hours']);
  assert.match(skipped[0].msg, /缺 stop\.poi\.hours/);
  assert.ok(r.warnings.some((w) => w.ruleId === 'boom' && w.code === 'rule-error'));
});

test('規則形狀不對在載入期就炸', () => {
  assert.throws(() => validateRule({ id: 'Bad Id', kind: 'hard', reads: [], apply() {} }), /小寫英數/);
  assert.throws(() => validateRule({ id: 'x', kind: 'fuzzy', reads: [], apply() {} }), /kind/);
  assert.throws(() => validateRule({ id: 'x', kind: 'soft', apply() {} }), /reads/);
  assert.throws(() => validateRule({ id: 'x', kind: 'soft', reads: [] }), /apply/);
  assert.throws(() => validateRule({ id: 'x', kind: 'dimension', scope: 'day', reads: [], apply() {} }), /dimension/);
  assert.throws(() => loadRules([walkDim, walkDim]), /重複/);
});
