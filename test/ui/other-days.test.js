// 他只動了某一天，別天的行程有沒有跟著變、那一句怎麼寫（ui/other-days.js；11-12 畫面審查）：純函式。
// 從鍵按到復原列的整條路在 plan-actions.test.js（換一家把別天引擎排的早餐拿走 → 復原列接「別天跟著變了：…」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherDayChanges, otherDaysText, addedWarnings, CUMULATIVE_RULES } from '../../src/ui/other-days.js';
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

test('挪店那一句的後半（11-24 傍晚主控定的短寫法）：那家原本那一天的事直接接日期——多出來的提示照原文、排進來的站照舊寫，不掛「別天跟著變了：」；這天與那天以外萬一變了照舊掛那個開頭、排在後面', () => {
  const warn = (msg, over = {}) => ({ ruleId: 'meal-slots', code: 'soft', msg, ...over });
  const withWarn = (p, warnings) => ({ plan: { ...p.plan, warnings } });
  const before = {
    [THU]: plan([stop('甲')]),
    [FRI]: withWarn(plan([engine('早一', 'breakfast'), stop('丙'), stop('丁')], { dropped: ['戊'], breakfast: '早一' }), [warn('今晚沒排夜間站', { ruleId: 'night-slot' })]),
    [SAT]: plan([stop('己'), engine('順路一')]),
  };
  // 丁 被挪到 THU：FRI 少了晚餐多一句黃字、原本排不進的戊排進來；原本就有的那一句不重複講
  const after = {
    [THU]: plan([stop('丁')]),
    [FRI]: withWarn(plan([engine('早一', 'breakfast'), stop('丙'), stop('戊')], { breakfast: '早一' }), [warn('今晚沒排夜間站', { ruleId: 'night-slot' }), warn('今天沒排晚餐'), warn('到 丙 這段走回頭路 9 分', { poiId: '丙', ruleId: 'backtrack' })]),
    [SAT]: plan([stop('己'), engine('順路一')]),
  };
  const moved = { date: FRI, poiId: '丁' };
  const changes = otherDayChanges({ before, after, dates: [THU], moved });
  assert.deepEqual(changes.map((c) => [c.date, names(c.revived), c.warned, names(c.gone)]), [[FRI, ['戊'], ['今天沒排晚餐'], []]], '那家自己不見了不算；只比整天的黃字，每站的不比');
  assert.equal(otherDaysText(changes, 2, FRI), '8/14（五） 戊 排進來了、今天沒排晚餐');
  // 引擎排的早餐被挪走、那天沒有別家早餐：只講多出來的那一句提示
  const bf = otherDayChanges({ before: { [FRI]: plan([engine('早一', 'breakfast'), stop('丙')], { breakfast: '早一' }) }, after: { [FRI]: withWarn(plan([stop('丙')]), [warn('今天沒排早餐', { ruleId: 'breakfast-slot', hint: true })]) }, dates: [], moved: { date: FRI, poiId: '早一' } });
  assert.equal(otherDaysText(bf, 2, FRI), '8/14（五） 今天沒排早餐');
  // 那天什麼都沒多：沒有那一段
  assert.equal(otherDaysText(otherDayChanges({ before: { [FRI]: plan([stop('丙'), stop('丁')]) }, after: { [FRI]: plan([stop('丙')]) }, dates: [], moved }), 2, FRI), '');
  // 第三天也變了（照理不會）：那一天照舊掛「別天跟著變了：」，接在原本那天後面
  const third = otherDayChanges({ before, after: { ...after, [SAT]: plan([stop('己'), engine('順路二')]) }, dates: [THU], moved });
  assert.equal(otherDaysText(third, 2, FRI), '8/14（五） 戊 排進來了、今天沒排晚餐；別天跟著變了：8/15（六） 引擎排的 順路一 換成 順路二');
  // 沒給那一天（別的動作）：照舊整句掛開頭
  assert.equal(otherDaysText(third), '別天跟著變了：8/14（五） 戊 排進來了、今天沒排晚餐；8/15（六） 引擎排的 順路一 換成 順路二');
  for (const s of [otherDaysText(changes, 2, FRI), otherDaysText(third, 2, FRI)]) assert.doesNotMatch(s, /undefined|\[object|NaN|null|多一句/);
});

test('這天多幾句提醒（addedWarnings；11-24 傍晚主控定：復原列只寫句數）：照畫面畫的那一批數——整天的＋每站的；換了店名的同一句、數字變了的同一句、累積型掛到別站都不算多出來的', () => {
  const w = (ruleId, poiId, msg, over = {}) => ({ ruleId, code: 'soft', poiId, msg, ...over });
  const p = (ids, warnings) => ({ sequence: ids.map((id) => stop(id)), warnings });
  const before = p(['甲', '乙', '丙'], [
    w('backtrack', '乙', '到 乙 這段走回頭路 12 分'),
    w('walk-budget', '丙', '今天走路會到 160 分，超過上限 150'),
    w('wait-at-door', '丙', '到 丙 要在門口等 40 分'),
    w('meal-slots', null, '今天沒排午餐'),
    w('breakfast-slot', null, '今天沒排早餐', { code: 'hint', hint: true }),
    w('leg-suggest', null, '甲→乙 這段走 12 分，經過 X，可升級成站', { code: 'hint', hint: true }),
  ]);
  const same = (after, as) => addedWarnings(before, after, as);
  assert.equal(same(before), 0);
  // 乙 換成 丁：丁 沿用乙的那一句（只是換了店名）不算；丁 多一句別的才算
  assert.equal(same(p(['甲', '丁', '丙'], [w('backtrack', '丁', '到 丁 這段走回頭路 15 分'), ...before.warnings.slice(1)]), { 丁: '乙' }), 0);
  assert.equal(same(p(['甲', '丁', '丙'], [w('backtrack', '丁', '到 丁 這段走回頭路 15 分'), w('recovery-run', '丁', '甲接著丁，兩個坐下來的站連著'), ...before.warnings.slice(1)]), { 丁: '乙' }), 1);
  assert.equal(same(p(['甲', '丁', '丙'], [w('backtrack', '丁', '到 丁 這段走回頭路 15 分'), ...before.warnings.slice(1)])), 1, '沒說丁頂的是誰：當成新的一句');
  // 別站多一句（原位置換掉的代價：走回頭路、兩個坐下來的站連著）
  assert.equal(same(p(['甲', '乙', '丙'], [...before.warnings, w('backtrack', '丙', '到 丙 這段走回頭路 17 分')])), 1);
  // 累積型（今天走路會到 N 分、連跑）一天只寫一次：換了之後掛在別站、數字不同都是同一句；原本沒有、現在有才算
  assert.equal(same(p(['甲', '乙', '丙'], [w('backtrack', '乙', 'x'), w('walk-budget', '乙', '今天走路會到 155 分，超過上限 150'), w('walk-budget', '丙', '今天走路會到 215 分，超過上限 150'), ...before.warnings.slice(2)])), 0);
  assert.equal(same(p(['甲', '乙', '丙'], [...before.warnings, w('walk-run', '乙', '連續走路已經 170 分，超過 150，該坐一下'), w('walk-run', '丙', '連續走路已經 230 分，超過 150，該坐一下')])), 1);
  // 整天的：多一種黃字算一句（今天沒排午餐 → 今天沒排午餐、晚餐 是不同的一句）；只是數字變了不算
  assert.equal(same(p(['甲', '乙', '丙'], [...before.warnings.filter((x) => x.msg !== '今天沒排午餐'), w('meal-slots', null, '今天沒排午餐、晚餐')])), 1);
  assert.equal(same(p(['甲', '乙', '丙'], [...before.warnings, w('anchor', null, '今天的主行程沒排進去（Utah）', { code: 'hard' }), w('designated', null, '指定的 1 站今天排不進')])), 2, '換掉主行程多出來的那兩句也算');
  const numbered = (n) => p(['甲'], [w('designated', null, `指定的 ${n} 站今天排不進`)]);
  assert.equal(addedWarnings(numbered(1), numbered(2)), 0);
  // 畫面不畫的不算：等開門那句（寫在移動那一行）、長段提示、不在序列裡的站的黃字
  assert.equal(same(p(['甲', '乙', '丙'], [...before.warnings, w('wait-at-door', '乙', '到 乙 要在門口等 30 分'), w('leg-suggest', null, '乙→丙 這段走 15 分，經過 Y，可升級成站', { hint: true }), w('hours', '不在序列裡', 'x')])), 0);
  // 少了幾句不扣、也不變成負的；沒有 plan 不丟錯
  assert.equal(same(p(['甲', '乙', '丙'], [])), 0);
  assert.deepEqual([addedWarnings(null, null), addedWarnings(null, before), addedWarnings(before, null)], [0, 4, 0]);
  assert.ok(CUMULATIVE_RULES.has('walk-budget') && CUMULATIVE_RULES.has('walk-run') && CUMULATIVE_RULES.has('shop-run') && !CUMULATIVE_RULES.has('backtrack'));
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
