// 他只動了某一天，別天的行程有沒有跟著變、那一句怎麼寫（ui/other-days.js；11-12 畫面審查）：純函式。
// 從鍵按到復原列的整條路在 plan-actions.test.js（換一家把別天引擎排的早餐拿走 → 復原列接「別天跟著變了：…」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherDayChanges, otherDaysText } from '../../src/ui/other-days.js';
import { undoBarStacked } from '../../src/ui/planner.js';

const THU = '2026-08-13'; const FRI = '2026-08-14'; const SAT = '2026-08-15'; const SUN = '2026-08-16'; const MON = '2026-08-17';
const poi = (id) => ({ id, name_zh: id });
const stop = (id, over = {}) => ({ poi: poi(id), insertedBy: null, priority: 'want', ...over });
const engine = (id, priority = 'onway') => stop(id, { insertedBy: 'engine', priority });
const plan = (sequence, { dropped = [], breakfast = null } = {}) => ({ plan: { sequence, dropped: dropped.map((id) => ({ poi: poi(id), reason: 'x' })), meals: { breakfast, lunch: null, dinner: null } } });
const names = (list) => list.map((p) => p.id);

test('otherDayChanges：動到的那幾天不算；別天的站一樣、先後一樣（只有時刻不同）不算；引擎排的站換了、早餐換店、勾選站排不進／排進來、先後變了各自認得出來', () => {
  const before = {
    [THU]: plan([stop('甲'), stop('乙')]),
    [FRI]: plan([engine('早一', 'breakfast'), stop('丙'), engine('順路一')], { breakfast: '早一' }),
    [SAT]: plan([stop('丁'), engine('順路二'), stop('戊')], { dropped: ['己'] }),
    [SUN]: plan([stop('庚'), stop('辛')]),
    [MON]: plan([{ ...stop('壬'), startMin: 600 }]),
  };
  const after = {
    [THU]: plan([stop('甲')]),   // 動到的那一天：不算
    [FRI]: plan([engine('早二', 'breakfast'), stop('丙'), engine('順路三')], { breakfast: '早二' }),   // 早餐換店、順路站換一家
    [SAT]: plan([stop('丁'), stop('己')], { dropped: ['戊'] }),   // 引擎站少一家、他勾的戊排不進了、原本排不進的己排進來
    [SUN]: plan([stop('辛'), stop('庚')]),   // 只有先後變了
    [MON]: plan([{ ...stop('壬'), startMin: 630 }]),   // 只有時刻不同：不算
  };
  const changes = otherDayChanges({ before, after, dates: [THU] });
  assert.deepEqual(changes.map((c) => c.date), [FRI, SAT, SUN]);
  const [fri, sat, sun] = changes;
  assert.deepEqual([fri.breakfast.from.id, fri.breakfast.to.id, names(fri.gone), names(fri.came), fri.reordered], ['早一', '早二', ['順路一'], ['順路三'], false]);
  assert.deepEqual([sat.breakfast, names(sat.dropped), names(sat.revived), names(sat.gone), names(sat.came)], [null, ['戊'], ['己'], ['順路二'], []]);
  assert.deepEqual([sun.reordered, names(sun.gone), names(sun.came), sun.breakfast], [true, [], [], null]);
  assert.equal(otherDaysText(changes), '別天跟著變了：8/14（五） 早餐換成 早二、引擎排的 順路一 換成 順路三；8/15（六） 戊 排不進了、己 排進來了、少了引擎排的 順路二；另外 8/16（日） 也變了');
  assert.equal(otherDaysText(changes, 3), '別天跟著變了：8/14（五） 早餐換成 早二、引擎排的 順路一 換成 順路三；8/15（六） 戊 排不進了、己 排進來了、少了引擎排的 順路二；8/16（日） 順序變了');
  // 什麼都沒變
  assert.deepEqual(otherDayChanges({ before, after: before, dates: [] }), []);
  assert.deepEqual(otherDayChanges({ before, after, dates: [THU, FRI, SAT, SUN] }), []);
  assert.deepEqual([otherDaysText([]), otherDaysText(null), otherDaysText()], ['', '', '']);
  // 少資料不丟錯：有一邊沒排（plan 是 null）、兩邊對不上的日子都跳過
  assert.deepEqual(otherDayChanges({ before: { [FRI]: { plan: null } }, after, dates: [] }), []);
  assert.deepEqual(otherDayChanges({ before, after: { [FRI]: { plan: null }, '2026-09-01': plan([stop('x')]) }, dates: [] }), []);
  assert.deepEqual(otherDayChanges(), []);
});

test('早餐的幾種寫法：換店、沒排了、多排了一家；早餐那一餐換到本來就在的站上不算換店；店名用短的（括號裡的註記拿掉）', () => {
  const one = (b, a) => otherDaysText(otherDayChanges({ before: { [FRI]: b }, after: { [FRI]: a }, dates: [] }));
  assert.equal(one(plan([engine('早一', 'breakfast'), stop('丙')], { breakfast: '早一' }), plan([stop('丙')])), '別天跟著變了：8/14（五） 早餐 早一 沒排了');
  assert.equal(one(plan([stop('丙')]), plan([engine('早二（站內的立食蕎麥）', 'breakfast'), stop('丙')], { breakfast: '早二（站內的立食蕎麥）' })), '別天跟著變了：8/14（五） 多排了早餐 早二');
  // 引擎排的早餐不見了、他勾的丙落在早餐時段變成那天的早餐：丙本來就在，講的是那一家沒排了
  assert.equal(one(plan([engine('早一', 'breakfast'), stop('丙')], { breakfast: '早一' }), plan([stop('丙')], { breakfast: '丙' })), '別天跟著變了：8/14（五） 早餐 早一 沒排了');
  // 早餐那一餐換到本來就在的站上、站都沒變：不算
  assert.equal(one(plan([stop('丙'), stop('丁')], { breakfast: '丙' }), plan([stop('丙'), stop('丁')], { breakfast: '丁' })), '');
  // 引擎排的站多兩家、少一家：分開寫
  assert.equal(one(plan([stop('丙'), engine('順路一')]), plan([stop('丙'), engine('順路二'), engine('填站三', 'filler')])), '別天跟著變了：8/14（五） 少了引擎排的 順路一、多了引擎排的 順路二、填站三');
  // 引擎排的站換了一家，兩版都有的那幾站先後也變了（那天重新搜尋過）：接一句「順序也變了」；先後沒變就不寫
  assert.equal(one(plan([stop('丙'), engine('順路一'), stop('丁')]), plan([stop('丁'), engine('順路二'), stop('丙')])), '別天跟著變了：8/14（五） 引擎排的 順路一 換成 順路二、順序也變了');
  assert.equal(one(plan([stop('丙'), engine('順路一'), stop('丁')]), plan([engine('順路二'), stop('丙'), stop('丁')])), '別天跟著變了：8/14（五） 引擎排的 順路一 換成 順路二');
  const moved = otherDayChanges({ before: { [FRI]: plan([stop('丙'), engine('順路一'), stop('丁')]) }, after: { [FRI]: plan([stop('丁'), engine('順路二'), stop('丙')]) }, dates: [] });
  assert.equal(moved[0].reordered, true);
  for (const s of [one(plan([engine('早一', 'breakfast')], { breakfast: '早一' }), plan([engine('早二', 'breakfast')], { breakfast: '早二' }))]) assert.doesNotMatch(s, /undefined|\[object|NaN|null|engine|breakfast|onway|filler/);
});

test('復原列的兩顆鍵（復原、關閉）怎麼排：照那一句的字寬估——四行以內並排、更長的疊成一欄（11-12 在 390px 實量：長句並排會多好幾行，短句疊起來反而比以前高）', () => {
  // 全形字算 1、半形算 0.55；超過 55 就疊
  assert.equal(undoBarStacked('已把 喫茶 Elbe（エルベ） 從 8/13（四） 拿掉'), false, '短句並排（量到 60px，跟只有「復原」時一樣高）');
  assert.equal(undoBarStacked('已把 DaTe Cafe O\'rder 排成第一站（立ちそば処 杜 之前），後面順延 31 分'), false, '三行：並排 81px');
  assert.equal(undoBarStacked('已把 喫茶 Elbe（エルベ） 從 8/13（四） 拿掉；別天跟著變了：8/15（六） 引擎排的 Room-9 換成 TRUE VINTAGE.'), false, '四行：並排 102px（疊起來最矮也要 109px）');
  assert.equal(undoBarStacked('已讓引擎重排 8/13（四）；別天跟著變了：8/14（五） 少了引擎排的 XXNT、SEGA-RU、多了引擎排的 ふじや千舟 本店、TRUE VINTAGE.；8/15（六） 引擎排的 Room-9 換成 SEGA-RU；另外 8/18（二） 也變了'), true, '長句疊起來（144px；並排是 165px）');
  assert.equal(undoBarStacked('字'.repeat(55)), false);
  assert.equal(undoBarStacked('字'.repeat(56)), true);
  assert.equal(undoBarStacked('a'.repeat(100)), false, '半形字一個算 0.55：100 個是 55');
  assert.equal(undoBarStacked('a'.repeat(101)), true);
  assert.deepEqual([undoBarStacked(''), undoBarStacked(null), undoBarStacked(undefined)], [false, false, false]);
});
