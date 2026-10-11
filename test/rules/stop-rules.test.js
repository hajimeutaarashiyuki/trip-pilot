// T3：站層級的硬約束與軟約束。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, ctx, run, warnOf, rules, settings } from './_fixtures.js';
import { evaluateStop } from '../../src/engine/evaluate.js';
import { budgetMultiplier } from '../../src/rules/_helpers.js';

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

test('wait-at-door：等開門超過 15 分的部分每分鐘罰 1、封頂 60；15 分內當留白；固定時段的站提早到是卡位不罰；第一站的等待已在排程改成晚出門（waitMin 0）', () => {
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 45 })), 30);
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 10 })), 0);
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 0 })), 0);
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 200 })), 60, '等 200 分罰到 capMin 60 封頂');
  assert.equal(run('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 75 })), 60, '剛好到頂');
  const fireworks = stop('花火', { category: 'event', walkFactor: 0, startMin: 19 * 60, dwellMin: 60, fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } });
  assert.equal(run('wait-at-door', ctx({ ...fireworks, waitMin: 200 })), 0, '固定時段（花火）前的空檔不是等開門');
  assert.match(warnOf('wait-at-door', ctx({ ...stop('Elbe'), waitMin: 45 })), /^到 Elbe 要在門口等 45 分$/);
});

test('late-departure：只罰當天第一站、比時窗起點晚超過 60 分的部分每分鐘 1、封頂 60；第二站不算；現場接著排（day.resumed）不算；晚出門日起點 11:00', () => {
  const first = (startMin) => ctx(stop('第一站', { startMin }), { prev: null, sequence: [] });
  assert.equal(run('late-departure', first(11 * 60 + 30)), 60, '11:30 才開始：超過 90 分，封頂 60');
  assert.equal(run('late-departure', first(10 * 60 + 30)), 30);
  assert.equal(run('late-departure', first(9 * 60 + 50)), 0);
  assert.equal(run('late-departure', ctx(stop('第二站', { startMin: 11 * 60 + 30 }), { prev: stop('第一站'), sequence: [stop('第一站')] })), 0, '第二站不算');
  assert.equal(run('late-departure', ctx(stop('第一站', { startMin: 11 * 60 + 30 }), { day: { resumed: true } })), 0, '現場改案從當下接著排，不是出門');
  assert.equal(run('late-departure', ctx(stop('第一站', { startMin: 12 * 60 }), { day: { window: { startMin: 11 * 60, endMin: 1440 } } })), 0, '晚出門日時窗起點 11:00，12:00 到第一站不罰');
  assert.match(warnOf('late-departure', first(11 * 60 + 30)), /^今天 11:30 才出門，比預設晚 150 分$/);
  assert.match(warnOf('late-departure', ctx({ ...stop('第一站', { startMin: 11 * 60 + 30 }), arriveMin: 11 * 60 + 30 }, { leg: { walkMin: 5, rideMin: 20, climbMin: 0 } })), /^今天 11:05 才出門，比預設晚 125 分$/, '出門時刻＝到第一站減移動');
  // 罰的是出門時刻：第一段車 60＋走 10、09:00 出門 10:10 到，不罰（10-12 對抗審查：原本罰的是第一站開始時刻）
  assert.equal(run('late-departure', ctx({ ...stop('第一站', { startMin: 10 * 60 + 10 }), arriveMin: 10 * 60 + 10 }, { prev: null, sequence: [], leg: { walkMin: 10, rideMin: 60, climbMin: 0 } })), 0, '準時出門、第一段 70 分不罰');
  assert.equal(run('late-departure', ctx(stop('第一站', { startMin: 11 * 60 + 30 }), { prev: null, sequence: [], day: { type: 'departure' } })), 0, '離境日不算');
  assert.equal(run('late-departure', ctx({ ...stop('花火', { startMin: 19 * 60, category: 'event', walkFactor: 0 }), fixedWindow: { startMin: 19 * 60 + 30, arriveEarlyMin: 30 } }, { prev: null, sequence: [] })), 0, '固定時段的站當第一站不算');
});

test('filler-gap：填站的起訖要在它的空檔內，超出＝never；不是填站、沒有 gap 都 ok', () => {
  const gap = { startMin: 600, endMin: 720 };
  const filler = (startMin, dwellMin = 30) => ({ ...stop('藥妝店', { startMin, dwellMin, category: 'drugstore', walkFactor: 0 }), priority: 'filler', optional: true, insertedBy: 'engine', gap });
  assert.equal(run('filler-gap', ctx(filler(600))), 'ok');
  assert.equal(run('filler-gap', ctx(filler(690))), 'ok', '剛好貼齊空檔結束');
  assert.equal(run('filler-gap', ctx(filler(700))), 'never', '11:40–12:10 超出 12:00');
  assert.equal(run('filler-gap', ctx(filler(590))), 'never', '比空檔早開始');
  assert.equal(run('filler-gap', ctx({ ...filler(700), priority: 'rest' })), 'ok', '恢復站不綁空檔');
  assert.equal(run('filler-gap', ctx({ ...filler(700), gap: null })), 'ok');
  assert.equal(run('filler-gap', ctx(stop('他勾的', { startMin: 700 }))), 'ok');
  assert.match(warnOf('filler-gap', ctx(filler(700))), /^藥妝店 不在空檔內（10:00–12:00）$/);
});

test('max-stops：只數他勾的站，引擎插的（optional）不佔名額', () => {
  const eight = Array.from({ length: 8 }, (_, i) => stop(`s${i}`));
  const opt = { ...stop('咖啡廳', { category: 'cafe', walkFactor: 0, recovery: true }), optional: true, insertedBy: 'engine', priority: 'rest' };
  assert.equal(run('max-stops', ctx(opt, { sequence: eight })), 'ok', '已經 8 站還能插引擎的站');
  assert.equal(run('max-stops', ctx(stop('第八站'), { sequence: [...eight.slice(0, 7), opt] })), 'ok', '7 站＋1 個引擎插的，第 8 個他勾的站排得進');
  assert.equal(run('max-stops', ctx(stop('第九站'), { sequence: [...eight, opt] })), 'never');
  assert.match(warnOf('max-stops', ctx(stop('第九站'), { sequence: [...eight, opt] })), /^今天已經 8 站，上限 8$/);
});

test('walk-budget：一日遊本身 ×0.7（原話 #160，跟早起日同值）；倍率同時中取最嚴', () => {
  assert.equal(settings.dayTripWalkFactor, 0.7);
  assert.equal(budgetMultiplier({ dayTrip: true }, settings), 0.7);
  assert.equal(budgetMultiplier({ dayTrip: true, earlyDay: true, party: 2, dayTripNext: true }, settings), 0.7, '四個倍率同時中取最嚴');
  assert.equal(budgetMultiplier({ party: 2 }, settings), 0.85);
  assert.equal(budgetMultiplier({}, settings), 1);
  const dt = ctx(stop('x'), { acc: { 'dim-walk': 120 }, day: { dayTrip: true } });
  assert.equal(run('walk-budget', dt), 120 - 150 * 0.7, '一日遊非早起日的預算是 150×0.7');
  assert.match(warnOf('walk-budget', dt), /超過上限 105/);
});
