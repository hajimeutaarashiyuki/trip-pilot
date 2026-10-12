// T3：整天層級的規則（主行程必排、指定行程缺席罰、主題日不連兩天、餐段、夜間站）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules } from './_fixtures.js';
import { evaluateDay } from '../../src/engine/evaluate.js';

const lunch = stop('一隆', { category: 'food', walkFactor: 0, recovery: true, startMin: 12 * 60 + 15, dwellMin: 65 });
const dinner = stop('Elbe', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, startMin: 17 * 60 + 30, dwellMin: 60 });
const night = stop('汐谷', { category: 'bar', walkFactor: 0, recovery: true, startMin: 18 * 60 + 45, dwellMin: 90 });
const late = stop('バンザイ', { category: 'bar', walkFactor: 0, recovery: true, startMin: 20 * 60 + 30, dwellMin: 90 });
const shrine = stop('大崎八幡宮', { id: 'osaki' });

test('anchor：主行程沒排進去整天 no', () => {
  const dayCtx = (seq) => ({ ...ctx(null, { sequence: seq, day: { anchorPoiId: 'osaki', anchorName: '大崎八幡宮' } }) });
  assert.equal(run('anchor', dayCtx([lunch])), 'no');
  assert.equal(run('anchor', dayCtx([shrine, lunch])), 'ok');
  assert.match(warnOf('anchor', dayCtx([lunch])), /主行程沒排進去（大崎八幡宮）/);
});

test('designated：每個沒排進的指定站罰 120 分，只警告不擋', () => {
  const c = ctx(null, { sequence: [shrine], day: { designated: ['osaki', 'utah', 'banzai'] } });
  assert.equal(run('designated', c), 240);
  assert.match(warnOf('designated', c), /指定的 2 站今天排不進：utah、banzai/);
});

test('item-gap：昨天整天古著、今天又整天古著 no；單一站不觸發', () => {
  assert.equal(run('item-gap', ctx(null, { day: { themeCategory: 'vintage', prevThemeCategory: 'vintage' } })), 'no');
  assert.equal(run('item-gap', ctx(null, { day: { themeCategory: null, prevThemeCategory: 'vintage' } })), 'ok');
  assert.equal(run('item-gap', ctx(null, { day: { themeCategory: 'vintage', prevThemeCategory: 'record' } })), 'ok');
});

test('meal-slots：午晚餐各缺一個罰 20；night-slot：normal 日 20:00 後沒 bar 罰 10，抵達日不管', () => {
  assert.equal(run('meal-slots', ctx(null, { sequence: [shrine] })), 40);
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch] })), 20);
  assert.match(warnOf('meal-slots', ctx(null, { sequence: [lunch] })), /沒排晚餐/);
  assert.equal(run('meal-slots', ctx(null, { sequence: [lunch, dinner] })), 0, '喫茶吃晚餐也算晚餐');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, night] })), 0, '18:45–20:15 跨到 20:00 算有');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, dinner] })), 10);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, late] })), 0);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch, late], day: { window: { startMin: 540, endMin: 22 * 60 + 30 }, windowRaw: { startMin: 540, endMin: 1440 } } })), 0, '留白扣掉後收工 22:30，20:30–22:00 的 bar 仍算夜間站（讀 country.nightSlot，不讀 day.window）');
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { type: 'arrival' } })), 0);
  assert.equal(run('night-slot', ctx(null, { sequence: [lunch], day: { nightSlotOff: true } })), 0, '早起日前一晚取消');
});

test('evaluateDay 把 day scope 的規則一起算', () => {
  const r = evaluateDay(ctx(null, { sequence: [shrine], day: { anchorPoiId: 'osaki', designated: ['utah'] } }), rules);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.penaltyMin, 120 + 40 + 10);
  assert.deepEqual(r.breakdown.map((b) => b.ruleId).sort(), ['designated', 'meal-slots', 'night-slot']);
});
