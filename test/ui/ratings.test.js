// T13 評分隔天補：走過沒評的隔天出現；略過的、評過的、今天的不出現；進度按日期記，換日期不歸零。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingRatings, mergeField, progressOf, daysBetween, pickFieldDate, catchUpFieldDate, skipStopPatch } from '../../src/ui/ratings.js';
import { TEXT } from '../../src/ui/text.js';

const poi = (id) => ({ id, name_zh: id });
const plans = {
  '2026-08-13': { plan: { sequence: [{ poi: poi('a') }, { poi: poi('b') }, { poi: poi('c') }] } },
  '2026-08-14': { plan: { sequence: [{ poi: poi('d') }, { poi: poi('e') }] } },
};
const keys = (list) => list.map((p) => `${p.date}:${p.poi.id}`);

test('走過沒評的站隔天出現、照當天順序；還沒走到的不出現', () => {
  const field = { progress: { '2026-08-13': 2 }, ratings: {} };
  assert.deepEqual(keys(pendingRatings({ plans, field, today: '2026-08-14' })), ['2026-08-13:a', '2026-08-13:b']);
});

test('略過的不出現、評過的不出現', () => {
  const field = { progress: { '2026-08-13': 3 }, ratings: { a: { skipped: true, at: 'x' }, b: { rating: 5, at: 'x' } } };
  assert.deepEqual(keys(pendingRatings({ plans, field, today: '2026-08-14' })), ['2026-08-13:c']);
});

test('今天的不出現（試走模式今天＝選的那天）；今天之後的也不出現；前幾天的都列、先日期再順序', () => {
  const field = { progress: { '2026-08-13': 2, '2026-08-14': 1 }, ratings: {} };
  assert.deepEqual(pendingRatings({ plans, field, today: '2026-08-13' }), []);
  assert.deepEqual(keys(pendingRatings({ plans, field, today: '2026-08-14' })), ['2026-08-13:a', '2026-08-13:b']);
  assert.deepEqual(keys(pendingRatings({ plans, field, today: '2026-08-15' })), ['2026-08-13:a', '2026-08-13:b', '2026-08-14:d']);
});

test('進度超過當天站數就裁掉；沒有那天的計畫、沒有 progress／ratings、沒有 today 都不炸', () => {
  assert.deepEqual(keys(pendingRatings({ plans, field: { progress: { '2026-08-13': 9 }, ratings: {} }, today: '2026-08-14' })), ['2026-08-13:a', '2026-08-13:b', '2026-08-13:c']);
  assert.deepEqual(pendingRatings({ plans, field: { progress: { '2026-08-12': 2 } }, today: '2026-08-14' }), []);
  assert.deepEqual(pendingRatings({ plans, field: {}, today: '2026-08-14' }), []);
  assert.deepEqual(pendingRatings({ plans: {}, field: { progress: { '2026-08-13': 2 } }, today: '2026-08-14' }), []);
  assert.deepEqual(pendingRatings({ plans, field: { progress: { '2026-08-13': 2 } } }), []);
});

test('mergeField：index 變動寫進 progress[date]；換日期接那天的進度、沒走過就 0；別天的進度留著；明講 index 就照它', () => {
  let f = { date: '2026-08-13', index: 0, ratings: {} };
  f = mergeField(f, { index: 2 });
  assert.equal(f.progress['2026-08-13'], 2);
  f = mergeField(f, { date: '2026-08-14' });
  assert.equal(f.index, 0);
  assert.equal(f.progress['2026-08-13'], 2, '昨天走到哪不歸零');
  assert.equal(f.progress['2026-08-14'], 0);
  f = mergeField(f, { index: 1 });
  f = mergeField(f, { date: '2026-08-13' });
  assert.equal(f.index, 2, '切回來接那天的進度');
  assert.equal(f.progress['2026-08-14'], 1);
  f = mergeField(f, { date: '2026-08-14', index: 0 });
  assert.equal(f.index, 0, '明講 index 就照它（回到出門）');
  assert.equal(f.progress['2026-08-14'], 0);
});

test('mergeField：舊版存的 field 沒有 progress，第一次更新就從 index 補上；只改別的欄位 index 不動、不改原物件', () => {
  const prev = { date: '2026-08-13', index: 3, ratings: {} };
  const f = mergeField(prev, { simNowMin: 600 });
  assert.equal(f.index, 3);
  assert.equal(f.progress['2026-08-13'], 3);
  assert.equal(f.simNowMin, 600);
  assert.equal(prev.progress, undefined);
});

test('progressOf：有 progress 用它；舊 field 沒 progress 時選的是 field.date 才退回 index，別天是 0；沒 field 是 0', () => {
  assert.equal(progressOf({ date: '2026-08-13', index: 3, progress: { '2026-08-13': 3, '2026-08-14': 1 } }, '2026-08-14'), 1);
  assert.equal(progressOf({ date: '2026-08-13', index: 3 }, '2026-08-13'), 3);
  assert.equal(progressOf({ date: '2026-08-13', index: 3 }, '2026-08-14'), 0);
  assert.equal(progressOf(null, '2026-08-13'), 0);
});

test('pickFieldDate：是這趟的一天就不動；不是（裝好時填的今天、換旅程）→ 今天是旅程日就今天、否則第一天；沒有天數回 null', () => {
  const dates = ['2026-08-13', '2026-08-17'];
  assert.equal(pickFieldDate({ date: '2026-08-17' }, dates, '2026-10-12'), '2026-08-17');
  assert.equal(pickFieldDate({ date: '2026-10-12' }, dates, '2026-10-12'), '2026-08-13', 'boot 填的今天不在這趟 → 第一天');
  assert.equal(pickFieldDate({ date: '2026-10-12' }, dates, '2026-08-17'), '2026-08-17', '今天是旅程日就今天');
  assert.equal(pickFieldDate({ date: null }, dates, '2026-10-12'), '2026-08-13');
  assert.equal(pickFieldDate(null, [], '2026-10-12'), null);
});

test('catchUpFieldDate（隔天打開 App）：真實模式、今天是旅程日、停在前一天 → 今天；試走模式、今天不是旅程日、已經是今天或更晚都不動', () => {
  const dates = ['2026-08-13', '2026-08-15', '2026-08-17'];
  assert.equal(catchUpFieldDate({ date: '2026-08-13', simulate: false }, dates, '2026-08-15'), '2026-08-15');
  assert.equal(catchUpFieldDate({ date: '2026-08-13' }, dates, '2026-08-17'), '2026-08-17', '隔了幾天也直接到今天');
  assert.equal(catchUpFieldDate({ date: '2026-08-13', simulate: true }, dates, '2026-08-15'), '2026-08-13', '試走模式不動');
  assert.equal(catchUpFieldDate({ date: '2026-08-13' }, dates, '2026-08-14'), '2026-08-13', '今天不是旅程日就不動');
  assert.equal(catchUpFieldDate({ date: '2026-08-15' }, dates, '2026-08-15'), '2026-08-15');
  assert.equal(catchUpFieldDate({ date: '2026-08-17' }, dates, '2026-08-15'), '2026-08-17', '提前看後面那天不往回切');
  assert.equal(catchUpFieldDate({ date: null }, dates, '2026-08-15'), null, '沒日期的交給 pickFieldDate');
  assert.equal(catchUpFieldDate(null, dates, '2026-08-15'), null);
  // 接上 mergeField：切到今天後 index 接那天的進度
  const f = mergeField({ date: '2026-08-13', index: 3, progress: { '2026-08-13': 3, '2026-08-15': 1 } }, { date: catchUpFieldDate({ date: '2026-08-13' }, dates, '2026-08-15') });
  assert.equal(f.date, '2026-08-15'); assert.equal(f.index, 1); assert.equal(f.progress['2026-08-13'], 3);
});

test('skipStopPatch（略過引擎插的站）：記成略過、進度前進一站、不彈評分；補評卡隔天不問它，但還是問走過沒評的一般站', () => {
  const field = { date: '2026-08-13', index: 1, ratings: {}, progress: { '2026-08-13': 1 } };
  const f = mergeField(field, skipStopPatch(field, '2026-08-13', 'b', 'T'));
  assert.equal(f.index, 2);
  assert.equal(f.progress['2026-08-13'], 2);
  assert.deepEqual(f.ratings.b, { skipped: true, at: 'T' });
  assert.deepEqual(keys(pendingRatings({ plans, field: f, today: '2026-08-14' })), ['2026-08-13:a'], 'a 走過沒評要問、b 略過的不問');
  // 看的是那天的進度，不是 field.index（選的是別天時）
  const other = mergeField({ date: '2026-08-14', index: 0, ratings: {}, progress: { '2026-08-13': 2, '2026-08-14': 0 } }, skipStopPatch({ date: '2026-08-14', index: 0, progress: { '2026-08-13': 2 } }, '2026-08-13', 'c', 'T'));
  assert.equal(other.date, '2026-08-13'); assert.equal(other.index, 3); assert.equal(other.progress['2026-08-13'], 3);
});

test('daysBetween：隔天 1、前天 2、示範旅程 8/13 → 8/17 是 4、同一天 0', () => {
  assert.equal(daysBetween('2026-08-13', '2026-08-14'), 1);
  assert.equal(daysBetween('2026-08-13', '2026-08-15'), 2);
  assert.equal(daysBetween('2026-08-13', '2026-08-17'), 4);
  assert.equal(daysBetween('2026-08-13', '2026-08-13'), 0);
});

test('補評卡標題：隔天寫昨天、再隔一天寫前天、更早寫日期；名字用頓號接', () => {
  assert.equal(TEXT.rateLaterWhen(1, '8/13（四）'), '昨天');
  assert.equal(TEXT.rateLaterWhen(2, '8/13（四）'), '前天');
  assert.equal(TEXT.rateLaterWhen(4, '8/13（四）'), '8/13（四）');
  assert.equal(TEXT.rateLater('昨天', '珈巣多夢、喫茶 Elbe'), '昨天去的 珈巣多夢、喫茶 Elbe 還沒評分');
  assert.equal(typeof TEXT.rateLaterSkip, 'string');
});
