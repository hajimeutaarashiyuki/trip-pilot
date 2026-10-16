// 同行者（T19；profile §9、DESIGN §4；原話 #136 需求單以人為單位、#144 兩人的調整衝突「取輕鬆的，取不嚴的那個」、#147 整趟的跟個人的分開）：
// personsOf 的三個來源（旅程檔 persons → 對得上的需求單 → 從 party 合成，行為跟只有 party 時一樣）；presentOn 只算同行那幾天、day.party 跟著變；
// mergeAdjustments 人之間取最鬆、avoid 取聯集；nightSlot none／less 進 day；avoidCategories 四個池與走廊都不拿、他勾的照排＋person-avoid 提示（不罰）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personsOf, presentOn, mergeAdjustments, briefApplies, personAvoids, personAvoidWarnings, parsePartialDays, cityNamesOf } from '../../src/engine/persons.js';
import { planTrip, restCandidates, fillCandidates, onTheWayCandidates, corridorFor } from '../../src/engine/trip.js';
import { budgetMultiplier } from '../../src/rules/_helpers.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const country = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [6, 7, 8, 9] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const ALL = { thu: [['09:00', '23:00']], fri: [['09:00', '23:00']] };   // 2026-08-13 是週四、08-14 週五
const poi = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: ALL, dwellMin: 70, daylightOnly: false, lat: 38.26, lng: 140.87, ...over });
const cafe = (id, over = {}) => poi(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, dwellMin: 40, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0 });
const walkers = [poi('街區A'), poi('街區B'), poi('街區C')];
const pois = Object.fromEntries(walkers.map((p) => [p.id, p]));
const dayOf = (date, over = {}) => ({ date, type: 'normal', designated: walkers.map((p) => p.id), picks: walkers.map((p) => ({ poiId: p.id, priority: 'must' })), ...over });
const ids = (plan) => plan.sequence.map((s) => s.poi.id);
const ME = { id: 'me', name: '我', isMe: true, adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '', avoidCategories: [] } };
const GF = (over = {}) => ({ id: 'gf', name: '女友', isMe: false, adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '', avoidCategories: [] }, ...over });

test('personsOf：沒 persons 從 party 合成（party 1 → 一段；party 2 → 兩段；party 缺或壞 → 一段），他永遠在第一段、預設調整；有 persons 照用、規範形狀、他排第一、壞的 dates 與店型丟掉', () => {
  const one = personsOf({ party: 1 });
  assert.deepEqual(one, [{ id: 'me', name: '', isMe: true, dates: [], partialDays: '', datesUnread: false, adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '', avoidCategories: [] }, source: 'party' }]);
  const two = personsOf({ party: 2 });
  assert.deepEqual(two.map((p) => [p.id, p.isMe, p.source]), [['me', true, 'party'], ['p1', false, 'party']]);
  assert.equal(personsOf({}).length, 1, 'party 缺 → 一段');
  assert.equal(personsOf({ party: 'x' }).length, 1, 'party 壞 → 一段');
  assert.equal(personsOf(null).length, 1);
  const warnings = [];
  const list = personsOf({ party: 1, persons: [
    { id: 'gf', name: '女友', dates: ['2026-08-14', 'bad', '2026-08-13', '2026-08-14'], adjustments: { stamina: 'easy', nightSlot: 'less', dislikes: '不想泡溫泉', avoidCategories: ['onsen', '神社', 'nope'] } },
    { name: 'V', isMe: true, adjustments: { stamina: 'hard' } },
  ] }, null, warnings);
  assert.deepEqual(list.map((p) => [p.id, p.name, p.isMe, p.source]), [['me', 'V', true, 'trip'], ['gf', '女友', false, 'trip']], 'isMe 的那段排第一、沒 id 的他補 me；有 persons 就不理 party');
  assert.deepEqual(list[0].adjustments, { stamina: 'hard', nightSlot: 'default', dislikes: '', avoidCategories: [] });
  assert.deepEqual(list[1].dates, ['2026-08-13', '2026-08-14'], '壞的日期丟掉、去重、排序');
  assert.deepEqual(list[1].adjustments, { stamina: 'easy', nightSlot: 'less', dislikes: '不想泡溫泉', avoidCategories: ['onsen', 'shrine'] }, '中文店型照對照表翻、翻不出的丟掉');
  assert.deepEqual(warnings.map((w) => [w.code, w.personId]), [['person-avoid-unknown', 'gf']]);
  assert.match(warnings[0].msg, /女友 不想去的「nope」看不出是哪一類店/);
  assert.doesNotThrow(() => personsOf({ persons: [{ adjustments: { avoidCategories: ['nope'] } }] }), '不給 warnings 也不丟錯');
  const dup = personsOf({ persons: [{ id: 'x', isMe: true }, { id: 'x' }, { id: 'x' }] });
  assert.deepEqual(dup.map((p) => p.id), ['x', 'p1', 'p2'], 'id 撞到就補');
});

const trip2 = { id: 't', cityName: '仙台', cityId: 'sendai', party: 1, homeBases: [{ poi: home }], days: [dayOf('2026-08-13'), dayOf('2026-08-14')] };
const brief = (over = {}) => ({ city: '仙台、松島', dates: { from: '2026-08-13', to: '2026-08-14' }, persons: [
  { id: 'me', name: '我', isMe: true, partialDays: '', adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '' } },
  { id: 'p-1', name: '同學', isMe: false, partialDays: '8/14', dates: ['2026-08-14'], adjustments: { stamina: 'easy', nightSlot: 'none', dislikes: '不想逛古著', avoidCategories: ['vintage'] } },
], ...over });

test('需求單覆蓋層：旅程檔沒 persons、需求單 city（任一段，跟 cityName／cityId／打包檔城市一邊包含另一邊，不分大小寫）與 dates 首尾對得上才用；stamina／nightSlot 生效、partialDays 讀得懂的轉成 dates（讀不懂整趟＋datesUnread）、dislikes 是文字不轉；旅程檔有 persons 就不理需求單', () => {
  const r = personsOf(trip2, brief());
  assert.deepEqual(r.map((p) => [p.id, p.name, p.isMe, p.source]), [['me', '我', true, 'brief'], ['p-1', '同學', false, 'brief']]);
  assert.deepEqual([r[1].dates, r[1].partialDays, r[1].datesUnread], [['2026-08-14'], '8/14', false], '旅程檔給的 dates 優先（夾具兩者一致）');
  assert.deepEqual(r[1].adjustments, { stamina: 'easy', nightSlot: 'none', dislikes: '不想逛古著', avoidCategories: [] }, 'dislikes 不轉成 avoidCategories');
  const person = (partialDays) => ({ id: 'p-1', name: '同學', isMe: false, partialDays, adjustments: { stamina: 'easy', nightSlot: 'none', dislikes: '' } });
  const only = (partialDays) => personsOf(trip2, brief({ persons: [brief().persons[0], person(partialDays)] }))[1];
  assert.deepEqual([only('8/14').dates, only('8/14').datesUnread], [['2026-08-14'], false], 'partialDays 轉成 dates（年取旅程那年）');
  const overlay = personsOf(trip2, brief({ persons: [brief().persons[0], person('8/14')] }));
  assert.deepEqual([presentOn(overlay, '2026-08-13').map((p) => p.id), presentOn(overlay, '2026-08-14').map((p) => p.id)], [['me'], ['me', 'p-1']], '只同行 8/14 的同學 8/13 不在場（之前整趟都在場、七天都 ×0.85）');
  assert.deepEqual([only('8/14 晚上到').dates, only('8/14 晚上到').datesUnread, only('8/14 晚上到').partialDays], [[], true, '8/14 晚上到'], '讀不懂：整趟都算、標 datesUnread（設定頁那行講）');
  assert.deepEqual([only('').dates, only('').datesUnread], [[], false], '沒寫＝整趟、不算讀不懂');
  assert.equal(briefApplies(trip2, brief()), true);
  assert.equal(briefApplies(trip2, brief({ city: 'Sendai' })), true, 'cityId 也對、不分大小寫');
  for (const city of ['仙台市', '日本仙台', '仙台（宮城）', '松島、仙台市', ' 仙台 ']) assert.equal(briefApplies(trip2, brief({ city })), true, `包含比對：${city}`);
  const noId = { ...trip2, cityId: undefined };
  assert.equal(briefApplies(noId, brief({ city: 'Sendai' })), false, '旅程檔只有 cityName 時 Sendai 對不上…');
  assert.equal(briefApplies(noId, brief({ city: 'Sendai' }), cityNamesOf({ city: { id: 'sendai', name_zh: '仙台' } })), true, '…打包檔的城市 id（kb.city）給了就對得上');
  assert.deepEqual(cityNamesOf({ zones: {} }), [], '沒 city 的 kb（測試夾具、舊打包）回空');
  assert.equal(personsOf(noId, brief({ city: 'Sendai' }), null, ['sendai'])[1]?.source, 'brief');
  assert.equal(briefApplies(trip2, brief({ city: '台' })), false, '短的那邊只有一個字不算包含');
  assert.equal(briefApplies(trip2, brief({ city: '東京' })), false);
  assert.equal(briefApplies(trip2, brief({ city: '' })), false);
  assert.equal(briefApplies(trip2, brief({ dates: { from: '2026-08-12', to: '2026-08-14' } })), false, '起日對不上');
  assert.equal(briefApplies(trip2, brief({ dates: { from: '2026-08-13', to: '2026-08-15' } })), false, '迄日對不上');
  assert.equal(briefApplies(trip2, brief({ persons: [] })), false);
  assert.equal(briefApplies(trip2, null), false);
  assert.deepEqual(personsOf(trip2, brief({ city: '東京' })).map((p) => p.source), ['party'], '對不上就從 party 合成（上一趟的需求單不會被拿來用）');
  assert.deepEqual(personsOf({ ...trip2, persons: [ME, GF()] }, brief()).map((p) => p.source), ['trip', 'trip'], '旅程檔有 persons 以旅程檔為準');
});

test('presentOn：dates 空＝整趟、有 dates 只算那幾天、他永遠在；兩天夾具同行者只在第二天 → 第一天 party 1 不乘 0.85、第二天 party 2 乘（walk-budget 的上限 150 → 128）', () => {
  const persons = [ME, GF({ dates: ['2026-08-14'] }), GF({ id: 'p2', dates: [] })];
  assert.deepEqual(presentOn(persons, '2026-08-13').map((p) => p.id), ['me', 'p2']);
  assert.deepEqual(presentOn(persons, '2026-08-14').map((p) => p.id), ['me', 'gf', 'p2']);
  assert.deepEqual(presentOn([{ ...ME, dates: ['2026-08-20'] }], '2026-08-13').map((p) => p.id), ['me'], '他自己的 dates 不算');
  const trip = { ...trip2, persons: [ME, GF({ dates: ['2026-08-14'] })] };
  const r = planTrip({ trip, pois, rules, settings, country, kb, legFn });
  const [d1, d2] = r.days;
  assert.equal(d1.day.party, 1); assert.equal(d2.day.party, 2);
  assert.deepEqual(d1.day.persons.map((p) => p.id), ['me']); assert.deepEqual(d2.day.persons.map((p) => p.id), ['me', 'gf']);
  assert.equal(budgetMultiplier(d1.day, settings), 1); assert.equal(budgetMultiplier(d2.day, settings), 0.85);
  const budgetWarn = (d) => d.plan.warnings.find((w) => w.ruleId === 'walk-budget')?.msg ?? '';
  assert.match(budgetWarn(d1), /超過上限 150/, `三站各 70 分、係數 1 一定超預算：${budgetWarn(d1)}`);
  assert.match(budgetWarn(d2), /超過上限 128/, `同行那天上限 150×0.85：${budgetWarn(d2)}`);
  // 沒 persons、party 2：跟以前一模一樣（兩天都乘）
  const legacy = planTrip({ trip: { ...trip2, party: 2 }, pois, rules, settings, country, kb, legFn });
  assert.deepEqual(legacy.days.map((d) => [d.day.party, budgetMultiplier(d.day, settings)]), [[2, 0.85], [2, 0.85]]);
  assert.deepEqual(legacy.days[0].day.adjust, { stamina: 'normal', nightSlot: 'default', avoidCategories: [], avoidBy: {} });
});

test('mergeAdjustments（原話 #144 取不嚴的）：easy 贏 normal 贏 hard；none 贏 less 贏 default；avoid 聯集、avoidBy 記是誰；沒同行者＝他自己的；空＝預設', () => {
  const adj = (stamina, nightSlot = 'default', avoidCategories = []) => ({ adjustments: { stamina, nightSlot, dislikes: '', avoidCategories } });
  assert.equal(mergeAdjustments([adj('hard'), adj('easy')]).stamina, 'easy');
  assert.equal(mergeAdjustments([adj('hard'), adj('normal')]).stamina, 'normal');
  assert.equal(mergeAdjustments([adj('hard'), adj('hard')]).stamina, 'hard', '全 hard 才 hard');
  assert.equal(mergeAdjustments([adj('normal', 'none'), adj('normal', 'less')]).nightSlot, 'none');
  assert.equal(mergeAdjustments([adj('normal', 'default'), adj('normal', 'less')]).nightSlot, 'less');
  assert.equal(mergeAdjustments([adj('normal', 'default'), adj('normal', 'default')]).nightSlot, 'default');
  const gf = { name: '女友', ...adj('normal', 'default', ['onsen', 'shrine']) };
  const m = mergeAdjustments([{ name: '我', isMe: true, ...adj('normal', 'default', ['shrine']) }, gf]);
  assert.deepEqual(m.avoidCategories, ['shrine', 'onsen']);
  assert.deepEqual(Object.fromEntries(Object.entries(m.avoidBy).map(([c, ps]) => [c, ps.map((p) => p.name)])), { shrine: ['我', '女友'], onsen: ['女友'] });
  assert.deepEqual(mergeAdjustments([adj('easy', 'less')]), { stamina: 'easy', nightSlot: 'less', avoidCategories: [], avoidBy: {} }, '一個人就是他自己的');
  assert.deepEqual(mergeAdjustments([]), { stamina: 'normal', nightSlot: 'default', avoidCategories: [], avoidBy: {} });
  assert.deepEqual(mergeAdjustments([{}, { adjustments: { stamina: 'x', nightSlot: 'y', avoidCategories: ['nope'] } }]), { stamina: 'normal', nightSlot: 'default', avoidCategories: [], avoidBy: {} }, '沒規範過的值當預設');
});

test('planTrip：在場有人 nightSlot none → day.nightSlotOff、那天不罰夜間站；less → day.nightSlotLess、罰分減半（10 → 5）；stamina 進 day.adjust', () => {
  const shop = poi('街區', { dwellMin: 60 });
  const mk = (persons) => planTrip({ trip: { id: 't', party: 1, homeBases: [{ poi: home }], persons, days: [{ date: '2026-08-13', type: 'normal', picks: [{ poiId: shop.id, priority: 'must' }] }] }, pois: { [shop.id]: shop }, rules, settings, country, kb, legFn }).days[0];
  const base = mk([ME, GF()]);
  assert.deepEqual([base.day.nightSlotOff, base.day.nightSlotLess], [false, false]);
  assert.ok(base.plan.warnings.some((w) => w.ruleId === 'night-slot'), '沒 bar 要罰夜間站');
  const none = mk([ME, GF({ adjustments: { stamina: 'normal', nightSlot: 'none' } })]);
  assert.deepEqual([none.day.nightSlotOff, none.day.nightSlotLess, none.day.adjust.nightSlot], [true, false, 'none']);
  assert.ok(!none.plan.warnings.some((w) => w.ruleId === 'night-slot'), '不排夜間站的那天不罰');
  assert.equal(base.plan.penaltyMin - none.plan.penaltyMin, 10);
  const less = mk([ME, GF({ adjustments: { stamina: 'easy', nightSlot: 'less' } })]);
  assert.deepEqual([less.day.nightSlotOff, less.day.nightSlotLess, less.day.adjust.stamina], [false, true, 'easy']);
  assert.ok(less.plan.warnings.some((w) => w.ruleId === 'night-slot'), '少排還是會提醒');
  assert.equal(base.plan.penaltyMin - less.plan.penaltyMin, 5, '罰分減半');
  assert.equal(budgetMultiplier(less.day, settings), 0.85, 'easy 進 budgetMultiplier');
});

test('avoidCategories：恢復站、填站、順路站、坐下來的地方四個池與走廊清單都不拿那些店型（看 category 與 alsoCategories）', () => {
  const avoid = (list) => ({ avoidCategories: list, avoidBy: {} });
  assert.equal(personAvoids(avoid(['cafe']), cafe('c')), true);
  assert.equal(personAvoids(avoid(['cafe']), poi('s', { category: 'store', alsoCategories: ['cafe'] })), true, 'alsoCategories 也算');
  assert.equal(personAvoids(avoid(['cafe']), poi('s')), false);
  assert.equal(personAvoids(undefined, cafe('c')), false);
  assert.equal(personAvoids(avoid([]), null), false);
  const day = { date: '2026-08-13', regionZones: ['town'], window: { startMin: 540, endMin: 1440 }, adjust: avoid(['cafe', 'record']) };
  // 恢復站
  assert.deepEqual(restCandidates({ restPool: [cafe('咖啡廳'), poi('食堂', { category: 'food', walkFactor: 0, recovery: true })], candidates: [{ poi: poi('A') }], day, home, settings }).map((c) => c.poi.id), ['食堂']);
  // 填站
  const seq = [{ poi: poi('A'), arriveMin: 540, startMin: 540, endMin: 600, waitMin: 0 }, { poi: poi('B', { hours: { thu: [['12:00', '23:00']] } }), arriveMin: 605, startMin: 720, endMin: 790, waitMin: 115 }];
  const plan = { sequence: seq, warnings: [{ ruleId: 'wait-at-door', code: 'soft', poiId: 'B', msg: '' }] };
  const fillPool = [poi('唱片行', { category: 'record', walkFactor: 0, dwellMin: 30 }), poi('古著店', { category: 'vintage', walkFactor: 0, dwellMin: 30 }), cafe('咖啡廳')];
  assert.deepEqual(fillCandidates({ restPool: fillPool, candidates: [], day, home, plan, settings }).map((c) => c.poi.id), ['古著店']);
  assert.deepEqual(fillCandidates({ restPool: fillPool, candidates: [], day: { ...day, adjust: undefined }, home, plan, settings }).map((c) => c.poi.id).sort(), ['古著店', '咖啡廳', '唱片行'], '沒 adjust 照舊');
  // 順路站
  const near = (a, b) => ({ walkMin: a.id === b.id ? 0 : 3, rideMin: 0, climbMin: 0 });
  assert.deepEqual(onTheWayCandidates({ restPool: fillPool.slice(0, 2), day, home, plan: { sequence: [{ poi: poi('A') }] }, legFn: near, settings }).map((c) => c.poi.id), ['古著店']);
  // 走廊清單：A→B 那段旁 33 m 的唱片行，avoid 就不列
  const A = poi('A', { lat: 38.26, lng: 140.88 }); const B = poi('B', { lat: 38.26, lng: 140.89 });
  const shop = poi('近33', { category: 'record', walkFactor: 0, dwellMin: 30, lat: 38.2603, lng: 140.885 });
  const walk = (a, b) => ({ walkMin: 12, rideMin: 0, climbMin: 0, mode: 'walk' });
  const corridorPlan = { sequence: [{ poi: A, arriveMin: 600, startMin: 600, endMin: 660 }, { poi: B, arriveMin: 672, startMin: 672, endMin: 732 }] };
  assert.deepEqual(corridorFor({ plan: corridorPlan, home, pool: [shop], legFn: walk, settings, day: { ...day, adjust: undefined } }).map((c) => c.pois.map((x) => x.poi.id)), [['近33']], '沒 avoid 照列');
  assert.deepEqual(corridorFor({ plan: corridorPlan, home, pool: [shop], legFn: walk, settings, day }), [], 'avoid 的店型不列');
  // 坐下來的地方（spot）
  const sea = poi('海邊', { category: 'spot', walkFactor: 0, recovery: true, hours: null, dwellMin: 30 });
  const shrine = poi('神社', { hours: { thu: [['09:00', '12:00']] } });
  const fw = poi('花火', { category: 'event', walkFactor: 0, hours: null, dwellMin: 60 });
  const spotTrip = (persons) => ({ id: 't', party: 1, homeBases: [{ poi: home }], persons, days: [{ date: '2026-08-13', type: 'normal', designated: ['神社', '花火'], picks: [{ poiId: '神社', priority: 'must' }, { poiId: '花火', priority: 'must', fixedWindow: { startMin: 13 * 60, arriveEarlyMin: 30 } }] }] });
  assert.deepEqual(ids(planTrip({ trip: spotTrip([ME]), pois: { 神社: shrine, 花火: fw }, rules, settings, country, kb, legFn, restPool: [sea] }).days[0].plan), ['神社', '海邊', '花火']);
  assert.deepEqual(ids(planTrip({ trip: spotTrip([ME, GF({ adjustments: { stamina: 'normal', nightSlot: 'default', avoidCategories: ['spot'] } })]), pois: { 神社: shrine, 花火: fw }, rules, settings, country, kb, legFn, restPool: [sea] }).days[0].plan), ['神社', '花火'], '同行者不去 spot 就不插海邊');
});

test('planTrip：同行者不去咖啡廳 → 走路連跑破表也不插咖啡廳（恢復站池不拿）；他勾的咖啡廳照排、那站一條 person-avoid 提示（hint、不罰）、引擎插的不出；alsoCategories 也算', () => {
  const trip = { id: 't', party: 1, homeBases: [{ poi: home }], days: [dayOf('2026-08-13')] };
  const pool = [cafe('咖啡廳'), cafe('第二家咖啡廳', { lng: 140.879 })];
  const withRest = planTrip({ trip: { ...trip, persons: [ME, GF()] }, pois, rules, settings, country, kb, legFn, restPool: pool }).days[0].plan;
  assert.ok(withRest.sequence.some((s) => s.poi.id === '咖啡廳' && s.insertedBy === 'engine'), `沒 avoid 時咖啡廳要被插進去：${ids(withRest).join('→')}`);
  const gf = GF({ adjustments: { stamina: 'normal', nightSlot: 'default', dislikes: '不想喝咖啡', avoidCategories: ['cafe'] } });
  const avoided = planTrip({ trip: { ...trip, persons: [ME, gf] }, pois, rules, settings, country, kb, legFn, restPool: pool }).days[0];
  assert.ok(!avoided.plan.sequence.some((s) => s.insertedBy), `同行者不去咖啡廳就不插：${ids(avoided.plan).join('→')}`);
  assert.deepEqual(avoided.day.adjust.avoidCategories, ['cafe']);
  assert.deepEqual(avoided.plan.warnings.filter((w) => w.ruleId === 'person-avoid'), [], '引擎沒排進去就沒有提示');
  // 他自己勾了咖啡廳：照排（總則 3）、那站多一條提示、分數不動
  const picked = { ...trip, days: [dayOf('2026-08-13', { picks: [...walkers.map((p) => ({ poiId: p.id, priority: 'must' })), { poiId: '咖啡廳', priority: 'want' }] })] };
  const allPois = { ...pois, 咖啡廳: pool[0] };
  const plain = planTrip({ trip: { ...picked, persons: [ME, GF()] }, pois: allPois, rules, settings, country, kb, legFn }).days[0].plan;
  const hinted = planTrip({ trip: { ...picked, persons: [ME, gf] }, pois: allPois, rules, settings, country, kb, legFn }).days[0].plan;
  assert.ok(hinted.sequence.some((s) => s.poi.id === '咖啡廳' && !s.insertedBy), `他勾的咖啡廳照排：${ids(hinted).join('→')}`);
  assert.deepEqual(ids(hinted), ids(plain));
  assert.equal(hinted.penaltyMin, plain.penaltyMin, '不罰');
  assert.equal(hinted.score, plain.score);
  assert.deepEqual(hinted.warnings.filter((w) => w.ruleId === 'person-avoid'), [{ ruleId: 'person-avoid', code: 'person-avoid', hint: true, poiId: '咖啡廳', msg: '女友這趟不想去咖啡廳，你勾了就照排' }]);
  assert.deepEqual(plain.warnings.filter((w) => w.ruleId === 'person-avoid'), []);
  // personAvoidWarnings：他自己寫的叫「你」、沒名字的同行者叫「同行者」、兩個人都不去就並列；引擎插的站不出；alsoCategories 也算
  const adjust = mergeAdjustments([{ ...ME, adjustments: { ...ME.adjustments, avoidCategories: ['shrine'] } }, GF({ name: '', adjustments: { stamina: 'normal', nightSlot: 'default', avoidCategories: ['shrine', 'onsen'] } })]);
  const seq = [{ poi: poi('神社', { category: 'shrine' }) }, { poi: poi('錢湯', { category: 'onsen' }) }, { poi: poi('引擎插的錢湯', { category: 'onsen' }), insertedBy: 'engine' }, { poi: poi('複合', { category: 'store', alsoCategories: ['onsen'] }) }, { poi: poi('無關') }];
  assert.deepEqual(personAvoidWarnings(seq, adjust).map((w) => [w.poiId, w.msg]), [['神社', '你、同行者這趟不想去神社，你勾了就照排'], ['錢湯', '同行者這趟不想去溫泉，你勾了就照排'], ['複合', '同行者這趟不想去溫泉，你勾了就照排']]);
  assert.deepEqual(personAvoidWarnings(seq, undefined), []);
});

test('parsePartialDays（需求單「只同行哪幾天」的自由文字；需求單頁的例子「例：8/14–16」）：單日、連號、跨月、起／到、月日寫法、ISO、全形；讀不懂回 null、沒寫回 []；年取旅程那年', () => {
  const days = ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'];
  const p = (t) => parsePartialDays(t, days);
  assert.deepEqual(p(''), []); assert.deepEqual(p('   '), []); assert.deepEqual(parsePartialDays(undefined, days), []);
  assert.deepEqual(p('8/14'), ['2026-08-14']);
  for (const t of ['8/14–16', '8/14-16', '8/14~8/16', '8/14 到 8/16', '8月14–16日', '8/14至16']) assert.deepEqual(p(t), ['2026-08-14', '2026-08-15', '2026-08-16'], t);
  for (const t of ['8/13、8/15', '8/13, 8/15', '8/13；8/15', '8/13 8/15', '8月13日、8月15日']) assert.deepEqual(p(t), ['2026-08-13', '2026-08-15'], t);
  for (const t of ['2026-08-14', '2026/8/14', '2026年8月14日', '８／１４']) assert.deepEqual(p(t), ['2026-08-14'], t);
  assert.deepEqual(p('8/16 起'), ['2026-08-16', '2026-08-17', '2026-08-18'], '起＝到旅程最後一天');
  assert.deepEqual(p('8/16 之後'), ['2026-08-16', '2026-08-17', '2026-08-18']);
  assert.deepEqual(p('到 8/13'), ['2026-08-12', '2026-08-13'], '到＝從旅程第一天');
  assert.deepEqual(p('8/13 前'), ['2026-08-12', '2026-08-13']);
  assert.deepEqual(p('8/30–9/2'), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'], '跨月；旅程外的日子照留（presentOn 對不到就是不在場）');
  assert.deepEqual(p('8/15、8/14–16'), ['2026-08-14', '2026-08-15', '2026-08-16'], '去重、排序');
  for (const t of ['8/14 晚上到', '週末', '8/16–14', '2/30', '14、15', '8/14–16–18', '到']) assert.equal(p(t), null, `讀不懂：${t}`);
  assert.deepEqual(parsePartialDays('1/1', ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']), ['2027-01-01'], '跨年的旅程挑落在旅程裡的那年');
  assert.deepEqual(parsePartialDays('12/31–1/1', ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(parsePartialDays('8/14', []), [`${new Date().getUTCFullYear()}-08-14`], '沒有旅程日期就用今年');
});
