// T3：站層級的硬約束與軟約束。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules, settings } from './_fixtures.js';
import { evaluateStop } from '../../src/engine/evaluate.js';

const HOURS = { thu: [['11:30', '13:30'], ['17:30', '21:00']] };   // 2026-08-13 是週四

test('hours：營業區間內 ok；開門前 no；全部過了 never；當天休 never；hours null 由引擎跳過並警告', () => {
  const s = (startMin, dwellMin = 60) => stop('Elbe', { category: 'cafe', hours: HOURS, startMin, dwellMin });
  assert.equal(run('hours', ctx(s(12 * 60))), 'ok');
  assert.equal(run('hours', ctx(s(11 * 60))), 'no');
  assert.equal(run('hours', ctx(s(16 * 60 + 35))), 'no', '16:35 到會跨到 17:00 關門，但晚上還有一段');
  assert.equal(run('hours', ctx(s(21 * 60 + 30))), 'never');
  assert.equal(run('hours', ctx(stop('X', { hours: { mon: [['09:00', '17:00']] }, startMin: 600 }))), 'never', '週四沒開');
  assert.match(warnOf('hours', ctx(s(11 * 60))), /11:00 到的時候不在營業時間內/);
  const r = evaluateStop(ctx(stop('巽や', { hours: null })), rules);
  assert.ok(r.warnings.some((w) => w.ruleId === 'hours' && w.code === 'skipped-missing'));
  assert.equal(r.verdict, 'ok');
});

test('fixed-window、window、max-stops', () => {
  const fw = stop('花火', { category: 'event', walkFactor: 0, startMin: 19 * 60 + 40, dwellMin: 20, fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(run('fixed-window', ctx(fw)), 'never');
  assert.equal(run('fixed-window', ctx({ ...fw, startMin: 19 * 60 })), 'ok');
  assert.equal(run('window', ctx(stop('夜', { startMin: 23 * 60 + 30, dwellMin: 60 }))), 'never');
  assert.equal(run('window', ctx(stop('夜', { startMin: 22 * 60, dwellMin: 60 }))), 'ok');
  const eight = Array.from({ length: 8 }, (_, i) => stop(`s${i}`));
  assert.equal(run('max-stops', ctx(stop('第九站'), { sequence: eight })), 'never');
  assert.equal(run('max-stops', ctx(stop('第八站'), { sequence: eight.slice(0, 7) })), 'ok');
});

test('same-type-day：非主題日第三家古著 no、主題日 ok；咖啡廳同樣；early-day 下午第二個非恢復站 no', () => {
  const v = stop('me', { category: 'vintage', walkFactor: 0 });
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 3 } } })), 'no');
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 2 } } })), 'ok');
  assert.equal(run('same-type-day', ctx(v, { acc: { 'dim-cat-count': { vintage: 4 } }, day: { themeCategory: 'vintage' } })), 'ok');
  const c = stop('Elbe', { category: 'cafe', cafeLike: true, recovery: true, walkFactor: 0 });
  assert.equal(run('same-type-day', ctx(c, { acc: { 'dim-cat-count': { cafe: 3 } } })), 'no');
  assert.match(warnOf('same-type-day', ctx(c, { acc: { 'dim-cat-count': { cafe: 3 } } })), /咖啡廳已經 2 家/);
  const pm = stop('神社', { startMin: 14 * 60 });
  assert.equal(run('early-day', ctx(pm, { day: { earlyDay: true }, acc: { 'dim-afternoon': 2 } })), 'no');
  assert.equal(run('early-day', ctx(pm, { day: { earlyDay: true }, acc: { 'dim-afternoon': 1 } })), 'ok');
  assert.equal(run('early-day', ctx(pm, { day: { earlyDay: false }, acc: { 'dim-afternoon': 5 } })), 'ok');
});

test('walk-budget：超過才罰、倍率取最嚴；walk-run、shop-run 超過的分鐘', () => {
  assert.equal(run('walk-budget', ctx(stop('x'), { acc: { 'dim-walk': 140 } })), 0);
  assert.equal(run('walk-budget', ctx(stop('x'), { acc: { 'dim-walk': 170 } })), 20);
  const strict = ctx(stop('x'), { acc: { 'dim-walk': 120 }, day: { earlyDay: true, party: 2, dayTripNext: true } });
  assert.equal(run('walk-budget', strict), 120 - 150 * settings.earlyDayWalkFactor, '三個倍率同時中取最嚴的 0.7');
  assert.match(warnOf('walk-budget', strict), /超過上限 105/);
  assert.equal(run('walk-run', ctx(stop('x'), { acc: { 'dim-walk-run': 170 } })), 20);
  assert.equal(run('shop-run', ctx(stop('x'), { acc: { 'dim-shop-run': { count: 5, min: 300 } } })), 60 + 60);
  assert.equal(run('shop-run', ctx(stop('x'), { acc: { 'dim-shop-run': { count: 4, min: 240 } } })), 0);
});

test('cafe-adjacent、recovery-run、backtrack、zone-exit、noon-urban', () => {
  const cafe = (n) => stop(n, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true });
  const food = stop('一隆', { category: 'food', walkFactor: 0, recovery: true });
  const bar = (n) => stop(n, { category: 'bar', walkFactor: 0, recovery: true });
  assert.equal(run('cafe-adjacent', ctx(cafe('火星の庭'), { prev: cafe('珈巣多夢') })), 40);
  assert.equal(run('cafe-adjacent', ctx(cafe('珈巣多夢'), { prev: food })), 0);
  assert.equal(run('recovery-run', ctx(cafe('珈巣多夢'), { prev: food, acc: { 'dim-rec-run': 2 } })), 10, '餐→咖啡 +10');
  assert.equal(run('recovery-run', ctx(bar('賓'), { prev: bar('汐谷'), acc: { 'dim-rec-run': 2 } })), 0, '續攤不罰');
  assert.equal(run('recovery-run', ctx(bar('汐谷'), { prev: food, acc: { 'dim-rec-run': 2 } })), 0, '晚餐接夜間站不罰');
  assert.equal(run('recovery-run', ctx(cafe('Elbe'), { prev: cafe('火星の庭'), acc: { 'dim-rec-run': 3 } })), 50, '第三個恢復站連排再 +40');
  assert.equal(run('backtrack', ctx(stop('x'), { leg: { walkMin: 10, backtrackMin: 5 } })), 10);
  assert.equal(run('zone-exit', ctx(stop('瑞鳳殿', { zoneId: 'kyogamine' }))), 60);
  assert.equal(run('zone-exit', ctx(stop('Utah'))), 0);
  const noon = stop('商店街', { category: 'arcade', walkFactor: 0.5, startMin: 12 * 60, dwellMin: 60 });
  assert.equal(run('noon-urban', ctx(noon)), 20);
  assert.equal(run('noon-urban', ctx({ ...noon, poi: { ...noon.poi, zoneId: 'matsushima' } })), 0, '松島不是都市');
  assert.equal(run('noon-urban', ctx(noon, { day: { date: '2026-11-13' } })), 0, '十一月不罰');
  assert.equal(run('noon-urban', ctx(stop('Utah', { category: 'vintage', walkFactor: 0, startMin: 12 * 60 }))), 0, '站著逛的店不罰');
});
