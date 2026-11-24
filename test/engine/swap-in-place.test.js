// 換一家與二選一的「或 B」一律原位置換掉、並把那天釘住（11-24；engine/choices.js swapInPlace、engine/insert.js pinDayAsPlanned）。
// 依據：原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」講的是升級成站，類推到換一家（推導）——他只說要換這一站，別的站不該跟著動；
// #90「如果我突然不想跑某一個行程，那我想在介面上點那個行程，然後會跳出類型分類且順路的推薦候選名單，讓我去更換行程」。
// 之前沒釘住的日子換了之後整天重新搜尋：選的那一家不保證排進去、同一天別的勾選站可能被擠掉（11-17 畫面審查：三包 168 次裡 29 次有問題）。
// 這裡驗：沒釘住的日子照畫面上這一版釘住、B 在 A 的原位置、其餘各站（他勾的、引擎排的）先後不變；清單上每一家與「或 B」先試排（pinnedSwapCheck／pinnedChoiceCheck 不分釘不釘住）；
// 選了別天已經排的店＝挪過來（那天的勾選拿掉，不記「不去了」）。小世界：town 一區、所有站同座標、站間走 5 分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../../src/engine/trip.js';
import { pinnedOf, pinEntriesOf } from '../../src/engine/insert.js';
import { pinnedSwapCheck, pinnedChoiceCheck, choicesFor } from '../../src/engine/choices.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
const COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [] }, utcOffsetMin: 540 };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const daily = (open, close) => Object.fromEntries(DAYS.map((k) => [k, [[open, close]]]));
const mk = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: daily('09:00', '23:00'), dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, my: {}, ...over });
const cafe = (id, over = {}) => mk(id, { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, meals: {}, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
const legFn = () => ({ walkMin: 5, rideMin: 0, climbMin: 0, mode: 'walk' });
const THU = '2026-08-13'; const FRI = '2026-08-14'; const SAT = '2026-08-15'; const SUN = '2026-08-16';
const AT = '2026-11-24T00:00:00.000Z';
const ids = (x) => (x.sequence ?? x).map((s) => s.poi.id);
const tripOf = (days, over = {}) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days: days.map((d) => ({ type: 'normal', ...d })), ...over });
const want = (...list) => list.map((id) => ({ poiId: id, priority: 'want' }));
const pinOf = (...list) => ({ at: AT, sequence: list.map((x) => (typeof x === 'string' ? { poiId: x } : x)) });
const poisOf = (world) => Object.fromEntries(world.map((p) => [p.id, p]));
const dayOf = (trip, date) => trip.days.find((d) => d.date === date);
const argsOf = (pool = [], country = COUNTRY) => ({ rules, settings, country, kb, legFn, restPool: pool });
const run = (trip, world, pool = []) => planTrip({ trip, pois: poisOf(world), ...argsOf(pool) });
const { swapInPlace, lockedPick } = await import('../../src/engine/choices.js');
const { pinDayAsPlanned } = await import('../../src/engine/insert.js');

const A = mk('街區A'); const B = mk('街區B'); const C = mk('街區C');
const lunch = mk('午餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('11:30', '14:30'), meals: { lunch: true } });
const dinner = mk('晚餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), meals: { dinner: true } });
const dinner2 = mk('晚餐二店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), dwellMin: 90, meals: { dinner: true } });
const longDinner = mk('吃很久的晚餐', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '24:00'), dwellMin: 300, meals: { dinner: true } });
const bar = mk('酒吧', { category: 'bar', walkFactor: 0, recovery: true, hours: daily('20:00', '24:00'), dwellMin: 150, meals: {} });
const WORLD = [A, B, C, lunch, dinner, dinner2, longDinner, bar];
const PICKS = [A.id, lunch.id, C.id, dinner.id, bar.id];

test('pinDayAsPlanned：把那天照畫面上這一版釘住（每一站、先後、停留，引擎排的站照原樣記著）；已經釘住、沒有那一天、沒有 plan 就回原 trip；釘住之後重排逐站相同', () => {
  // 第一站只開到 11:00、第二站 12:00 才開：中間的空檔引擎會填一家咖啡廳（引擎站也要記進順序）
  const first = mk('早的', { hours: daily('09:00', '11:00') }); const late = mk('晚開', { hours: daily('12:00', '23:00') });
  const fill = cafe('咖啡廳', { dwellMin: 40 });
  const world = [first, late, dinner, fill];
  const trip = tripOf([{ date: THU, picks: want(first.id, late.id, dinner.id) }, { date: FRI, picks: want() }]);
  const d = run(trip, world, [fill]).days[0];
  assert.ok(!d.plan.pinned && d.plan.sequence.some((s) => s.insertedBy === 'engine'), `沒釘住、有一站引擎排的：${ids(d.plan).join('→')}`);
  const pinned = pinDayAsPlanned(trip, THU, d.plan, AT);
  assert.deepEqual(dayOf(pinned, THU).pinned, { at: AT, sequence: pinEntriesOf(d.plan.sequence, THU) });
  assert.deepEqual(pinnedOf(dayOf(pinned, THU)).sequence.map((e) => [e.poiId, e.insertedBy ?? null]), d.plan.sequence.map((s) => [s.poi.id, s.insertedBy ?? null]));
  assert.equal(dayOf(trip, THU).pinned, undefined, '不改傳入的');
  assert.deepEqual(dayOf(pinned, THU).picks, dayOf(trip, THU).picks, '勾選不動');
  const again = run(pinned, world, [fill]).days[0].plan;
  assert.equal(again.pinned, true);
  assert.deepEqual(again.sequence.map((s) => [s.poi.id, s.startMin, s.endMin]), d.plan.sequence.map((s) => [s.poi.id, s.startMin, s.endMin]), '釘住之後重排：逐站、逐時刻相同');
  assert.deepEqual(again.dropped, d.plan.dropped);
  // 不動的情況：回同一個物件
  assert.equal(pinDayAsPlanned(pinned, THU, d.plan, 'x'), pinned, '已經釘住');
  assert.equal(pinDayAsPlanned(trip, SUN, d.plan, AT), trip, '沒有那一天');
  assert.equal(pinDayAsPlanned(trip, THU, null, AT), trip);
  assert.equal(pinDayAsPlanned(trip, THU, { sequence: 'x' }, AT), trip);
});

test('swapInPlace：沒釘住的日子換一家＝照畫面上這一版釘住、A 原位置換成 B，其餘各站先後不變、前面各站時刻不動；換掉的記在 swapped；不改傳入的', () => {
  const trip = tripOf([{ date: THU, picks: want(...PICKS) }, { date: FRI, picks: want(B.id) }]);
  const base = run(trip, WORLD);
  const d = base.days[0]; const order = ids(d.plan);
  assert.ok(!d.plan.pinned && order.includes(dinner.id) && d.plan.dropped.length === 0, `沒釘住、五站都排進去：${order.join('→')}`);
  const next = swapInPlace({ trip, date: THU, fromPoiId: dinner.id, toPoi: dinner2, plan: d.plan, pois: poisOf(WORLD), at: AT });
  const want2 = order.map((id) => (id === dinner.id ? dinner2.id : id));
  const day = dayOf(next, THU);
  assert.deepEqual(day.pinned.sequence.map((e) => e.poiId), want2, '那天釘住：順序就是畫面上那一版，A 的那一筆原位置換成 B');
  assert.equal(day.pinned.at, AT);
  assert.deepEqual(day.pinned.sequence.find((e) => e.poiId === dinner2.id), { poiId: dinner2.id }, '舊那家的停留不沿用');
  assert.deepEqual(day.picks.map((p) => p.poiId), PICKS.map((id) => (id === dinner.id ? dinner2.id : id)));
  assert.deepEqual(day.swapped, [{ from: dinner.id, to: dinner2.id, at: AT, hold: true }], '換掉的不算落選（原話 #91），記在 swapped');
  assert.equal(day.removed, undefined, '不記「不去了」');
  assert.deepEqual([dayOf(trip, THU).pinned, dayOf(trip, THU).swapped, dayOf(trip, THU).picks.map((p) => p.poiId)], [undefined, undefined, PICKS], '不改傳入的');
  assert.equal(dayOf(next, FRI), dayOf(trip, FRI), '別天原物件');
  const after = run(next, WORLD).days[0].plan;
  assert.equal(after.pinned, true);
  assert.deepEqual(ids(after), want2);
  assert.deepEqual(after.dropped, []);
  const at = order.indexOf(dinner.id);
  assert.deepEqual(after.sequence.slice(0, at).map((s) => [s.poi.id, s.startMin, s.endMin]), d.plan.sequence.slice(0, at).map((s) => [s.poi.id, s.startMin, s.endMin]), '前面各站的時刻不動');
  assert.equal(after.sequence[at].dwellMin, 90, '新的那一家用它自己的停留');
  assert.equal(after.sequence[at].startMin, d.plan.sequence[at].startMin, '在 A 原本的時刻開始');
  // 已經釘住的日子：照舊在那條順序上原位置換掉（at 不重寫）
  const pinned = tripOf([{ date: THU, picks: want(...PICKS), pinned: { at: 'old', sequence: order.map((poiId) => ({ poiId })) } }]);
  const p = run(pinned, WORLD).days[0].plan;
  const again = swapInPlace({ trip: pinned, date: THU, fromPoiId: dinner.id, toPoi: dinner2, plan: p, pois: poisOf(WORLD), at: AT });
  assert.deepEqual([dayOf(again, THU).pinned.at, dayOf(again, THU).pinned.sequence.map((e) => e.poiId)], ['old', want2]);
  // 沒有那一天、沒給店：回原 trip
  assert.equal(swapInPlace({ trip, date: SUN, fromPoiId: dinner.id, toPoi: dinner2, plan: d.plan, pois: poisOf(WORLD) }), trip);
  assert.equal(swapInPlace({ trip, date: THU, fromPoiId: dinner.id, toPoi: null, plan: d.plan, pois: poisOf(WORLD) }), trip);
});

test('沒釘住的日子引擎排的站也留在原位置：填空檔的咖啡廳記進順序，換一家之後還在同一個位置（之前整天重新搜尋，引擎站重新決定）', () => {
  const first = mk('早的', { hours: daily('09:00', '11:00') }); const late = mk('晚開', { hours: daily('12:00', '23:00') });
  const fill = cafe('咖啡廳', { dwellMin: 40 });
  const world = [first, late, dinner, dinner2, fill];
  const trip = tripOf([{ date: THU, picks: want(first.id, late.id, dinner.id) }]);
  const d = run(trip, world, [fill]).days[0];
  const order = ids(d.plan);
  assert.ok(d.plan.sequence.some((s) => s.poi.id === fill.id && s.insertedBy === 'engine'), order.join('→'));
  const next = swapInPlace({ trip, date: THU, fromPoiId: dinner.id, toPoi: dinner2, plan: d.plan, pois: poisOf(world), at: AT });
  const after = run(next, world, [fill]).days[0].plan;
  assert.deepEqual(ids(after), order.map((id) => (id === dinner.id ? dinner2.id : id)));
  assert.deepEqual(after.sequence.filter((s) => s.insertedBy).map((s) => [s.poi.id, s.priority]), [[fill.id, 'filler']], '引擎排的那一站還在、還是引擎排的');
  assert.deepEqual(dayOf(next, THU).pinned.sequence.find((e) => e.poiId === fill.id).insertedBy, 'engine');
});

test('清單上的每一家先試排（pinnedSwapCheck 不分釘不釘住）：換了會讓後面的站排不進的不列；排得進的列——之前沒釘住的日子一律放行', () => {
  const trip = tripOf([{ date: THU, picks: want(...PICKS) }]);
  const d = run(trip, WORLD).days[0];
  assert.ok(!d.plan.pinned);
  const check = pinnedSwapCheck({ trip, date: THU, fromPoiId: dinner.id, plan: d.plan, pois: poisOf(WORLD), planArgs: argsOf() });
  assert.equal(check(dinner2), true, '晚餐二店（90 分）：排得進');
  assert.equal(check(longDinner), false, '吃 300 分的晚餐：後面的酒吧會待過 24:00，不列');
  assert.equal(check(null), false);
  // 說不列的那一家真的選下去：後面的站落到排不進清單（這就是要擋的事）
  const blind = run(swapInPlace({ trip, date: THU, fromPoiId: dinner.id, toPoi: longDinner, plan: d.plan, pois: poisOf(WORLD), at: AT }), WORLD).days[0].plan;
  assert.ok(blind.dropped.some((x) => x.poi.id === bar.id), `酒吧排不進：${blind.dropped.map((x) => x.poi.id).join('、')}`);
  // 放行的選下去：逐站就是試排的那一條
  const ok = run(swapInPlace({ trip, date: THU, fromPoiId: dinner.id, toPoi: dinner2, plan: d.plan, pois: poisOf(WORLD), at: AT }), WORLD).days[0].plan;
  assert.deepEqual(ids(ok), ids(d.plan).map((id) => (id === dinner.id ? dinner2.id : id)));
  // 換的那一站不在序列裡、沒有那一天：不列／放行（沒得試）
  assert.equal(pinnedSwapCheck({ trip, date: THU, fromPoiId: '不在序列裡', plan: d.plan, pois: poisOf(WORLD), planArgs: argsOf() })(dinner2), false);
  assert.equal(pinnedSwapCheck({ trip, date: SUN, fromPoiId: dinner.id, plan: d.plan, pois: poisOf(WORLD), planArgs: argsOf() })(dinner2), true);
  assert.equal(pinnedSwapCheck({ trip, date: THU, fromPoiId: dinner.id, plan: null, pois: poisOf(WORLD), planArgs: argsOf() })(dinner2), true);
});

test('當天勾了但排不進的那一家換進來：A 的那筆拿掉、它自己那筆留著，排在 A 的原位置；同類的另一家照舊排不進（之前整天重新搜尋，誰排進去由分數決定）', () => {
  // 三家咖啡廳勾在同一天（不是主題日，同類一天最多 2 家）：有一家排不進
  const c1 = cafe('咖啡一', { my: { rating: 5 } }); const c2 = cafe('咖啡二', { my: { rating: 5 } }); const c3 = cafe('咖啡三'); const c4 = cafe('咖啡四');
  const world = [A, B, c1, c2, c3, c4];
  const trip = tripOf([{ date: THU, picks: want(A.id, B.id, c1.id, c2.id, c3.id, c4.id) }]);
  const d = run(trip, world).days[0];
  const order = ids(d.plan);
  assert.deepEqual(d.plan.dropped.map((x) => x.poi.id).sort(), [c3.id, c4.id], order.join('→'));
  const check = pinnedSwapCheck({ trip, date: THU, fromPoiId: c1.id, plan: d.plan, pois: poisOf(world), planArgs: argsOf() });
  assert.equal(check(c4), true);
  const next = swapInPlace({ trip, date: THU, fromPoiId: c1.id, toPoi: c4, plan: d.plan, pois: poisOf(world), at: AT });
  assert.deepEqual(dayOf(next, THU).picks.map((p) => p.poiId), [A.id, B.id, c2.id, c3.id, c4.id], 'A 的那筆拿掉、B 自己那筆留著（一筆）');
  const after = run(next, world).days[0].plan;
  assert.deepEqual(ids(after), order.map((id) => (id === c1.id ? c4.id : id)), '選的那一家就在 A 的原位置');
  assert.deepEqual(after.dropped.map((x) => x.poi.id), [c3.id], '咖啡三照舊排不進（同類上限），沒有別的站掉下去');
});

test('選了別天已經排的店＝挪過來：它原本那天的勾選拿掉（不記不去了、不記換掉）、那天釘住的話順序裡那一筆也拿掉、順延紀錄一併拿掉；同一處的另一筆也算；必去／指定／主行程／固定時段的不動', () => {
  const twin = mk('晚餐二店別館', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), meals: { dinner: true }, samePlace: dinner2.id });
  const world = [...WORLD, twin];
  const pois = poisOf(world);
  const mkTrip = (fri, over = {}) => tripOf([{ date: THU, picks: want(...PICKS) }, { date: FRI, ...fri }, { date: SAT, picks: want() }], over);
  const go = (trip) => { const d = run(trip, world).days[0]; return swapInPlace({ trip, date: THU, fromPoiId: dinner.id, toPoi: dinner2, plan: d.plan, pois, at: AT }); };
  // 別天他勾的（沒釘住）
  const t1 = mkTrip({ picks: want(B.id, dinner2.id) });
  const n1 = go(t1);
  assert.deepEqual(dayOf(n1, FRI).picks.map((p) => p.poiId), [B.id], '那天的勾選拿掉');
  assert.deepEqual([dayOf(n1, FRI).removed, dayOf(n1, FRI).swapped], [undefined, undefined], '不是不去了、也不是換掉：不留紀錄');
  assert.ok(dayOf(n1, THU).picks.some((p) => p.poiId === dinner2.id));
  assert.deepEqual(dayOf(t1, FRI).picks.map((p) => p.poiId), [B.id, dinner2.id], '不改傳入的');
  const r1 = run(n1, world);
  assert.ok(ids(r1.days[0].plan).includes(dinner2.id) && !ids(r1.days[1].plan).includes(dinner2.id), '那家只在這天');
  // 別天釘住：順序裡那一筆也拿掉，其餘不動
  const t2 = mkTrip({ picks: want(B.id, dinner2.id), pinned: pinOf(B.id, { poiId: dinner2.id, dwellMin: 70 }) });
  const n2 = go(t2);
  assert.deepEqual([dayOf(n2, FRI).picks.map((p) => p.poiId), dayOf(n2, FRI).pinned.sequence], [[B.id], [{ poiId: B.id }]]);
  assert.equal(dayOf(n2, FRI).pinned.at, AT, '那天照樣是釘住的');
  // 順延過去的（picks[].deferredFrom＋trip.deferred 那一筆）：紀錄一併拿掉；別家的紀錄不動
  const other = { poiId: C.id, chosenPoiId: null, fromDate: THU, toDate: SAT, status: 'placed', at: 'T0' };
  const t3 = mkTrip({ picks: [...want(B.id), { poiId: dinner2.id, priority: 'want', deferredFrom: SAT }] }, { deferred: [{ poiId: dinner2.id, chosenPoiId: null, fromDate: SAT, toDate: FRI, status: 'placed', at: 'T0' }, other] });
  const n3 = go(t3);
  assert.deepEqual([dayOf(n3, FRI).picks.map((p) => p.poiId), n3.deferred], [[B.id], [other]]);
  // 同一處的另一筆勾在別天：一起拿掉（同一處當同一家）
  const n4 = go(mkTrip({ picks: want(B.id, twin.id) }));
  assert.deepEqual(dayOf(n4, FRI).picks.map((p) => p.poiId), [B.id]);
  // 必去、指定、主行程、帶固定時段的：不動（那一天不能少了它；清單也不會列）
  for (const [label, fri] of [
    ['必去', { picks: [...want(B.id), { poiId: dinner2.id, priority: 'must' }] }],
    ['指定', { picks: want(B.id, dinner2.id), designated: [dinner2.id] }],
    ['主行程', { picks: want(B.id, dinner2.id), anchor: { poiId: dinner2.id } }],
    ['固定時段', { picks: [...want(B.id), { poiId: dinner2.id, priority: 'want', fixedWindow: { startMin: 1080 } }] }],
  ]) {
    const t = mkTrip(fri);
    assert.equal(lockedPick(dayOf(t, FRI), dinner2.id), true, label);
    assert.deepEqual(dayOf(go(t), FRI).picks.map((p) => p.poiId), [B.id, dinner2.id], `${label}：不挪`);
  }
  assert.deepEqual([lockedPick(dayOf(t1, FRI), dinner2.id), lockedPick(dayOf(t1, FRI), '沒勾的'), lockedPick(null, 'x'), lockedPick({ anchor: { theme: 'cafe', poiIds: ['x'] } }, 'x')], [false, false, false, true]);
  // 別天引擎排的（不在勾選裡）：旅程檔不用改，重排時引擎自己不會再排它
  const fill = cafe('咖啡廳', { dwellMin: 40 });
  const first = mk('早的', { hours: daily('09:00', '11:00') }); const late = mk('晚開', { hours: daily('12:00', '23:00') });
  const ca5 = cafe('咖啡甲');
  const w5 = [...world, fill, first, late, ca5];
  const t5 = tripOf([{ date: THU, picks: want(A.id, ca5.id) }, { date: FRI, picks: want(first.id, late.id) }]);
  const b5 = planTrip({ trip: t5, pois: poisOf(w5), ...argsOf([fill]) });
  assert.ok(b5.days[1].plan.sequence.some((s) => s.poi.id === fill.id && s.insertedBy === 'engine'), `FRI 引擎排了咖啡廳：${ids(b5.days[1].plan).join('→')}`);
  const n5 = swapInPlace({ trip: t5, date: THU, fromPoiId: ca5.id, toPoi: fill, plan: b5.days[0].plan, pois: poisOf(w5), at: AT });
  assert.equal(dayOf(n5, FRI), dayOf(t5, FRI), '引擎排的：那一天的旅程檔不動');
  const r5 = planTrip({ trip: n5, pois: poisOf(w5), ...argsOf([fill]) });
  assert.ok(ids(r5.days[0].plan).includes(fill.id) && !ids(r5.days[1].plan).includes(fill.id), '重排之後它只在這天，那天引擎不再排它');
});

test('二選一的「或 B」也先試排、也原位置換掉（pinnedChoiceCheck、choicesFor 不分釘不釘住）：選了會害別的站排不進的不出；出的選下去 B 就在 A 的原位置、那天釘住', () => {
  const ca = cafe('咖啡甲'); const cx = cafe('咖啡戊'); const slow = cafe('坐很久的咖啡', { dwellMin: 300 });
  const world = [A, lunch, dinner, ca, cx, slow];
  // 沒釘住的一天（照搜尋排）：把咖啡甲換成坐 300 分的那一家，後面有站會排不進
  const loose = tripOf([{ date: THU, picks: want(ca.id, lunch.id, A.id, dinner.id) }, { date: FRI, picks: want() }, { date: SAT, picks: want() }, { date: SUN, picks: want() }]);
  const d = planTrip({ trip: loose, pois: poisOf(world), ...argsOf([slow, cx]) }).days[0];
  assert.ok(!d.plan.pinned);
  const at = ids(d.plan).indexOf(ca.id);
  const before = ids(d.plan);
  const choice = (b) => ({ date: THU, poiId: ca.id, slot: at, options: [ca.id, b.id], source: 'pool', detourMin: 5, altPoi: b });
  const check = pinnedChoiceCheck({ trip: loose, date: THU, plan: d.plan, pois: poisOf(world), planArgs: argsOf([slow, cx]) });
  const afterOf = (b) => planTrip({ trip: swapInPlace({ trip: loose, date: THU, fromPoiId: ca.id, toPoi: b, plan: d.plan, pois: poisOf(world), at: AT }), pois: poisOf(world), ...argsOf([slow, cx]) }).days[0].plan;
  // 試排說什麼，選下去就是什麼
  for (const b of [cx, slow]) {
    const after = afterOf(b);
    const fine = ids(after).filter((id) => id !== b.id).join('|') === before.filter((id) => id !== ca.id).join('|') && ids(after).indexOf(b.id) === at && after.dropped.length === 0;
    assert.equal(check(choice(b)), fine, `${b.id}：試排的答案跟真的選下去一樣（${ids(after).join('→')}；排不進 ${after.dropped.map((x) => x.poi.id).join('、') || '無'}）`);
  }
  assert.equal(check(choice(cx)), true, '停 60 分的咖啡廳：可以出');
  assert.equal(check(choice(slow)), false, '坐 300 分的：選了有站會排不進，不出');
  assert.deepEqual([check(null), check({ ...choice(cx), poiId: '不在序列裡' }), check({ ...choice(cx), altPoi: undefined })], [false, false, true]);
  // choicesFor：沒釘住的日子也只留試排過的（之前原樣回引擎給的）
  const listed = choicesFor({ trip: loose, date: THU, plan: { ...d.plan, choices: [choice(slow), choice(cx)] }, pois: poisOf(world), planArgs: argsOf([slow, cx]) });
  assert.deepEqual(listed.map((c) => c.options[1]), [cx.id]);
  assert.deepEqual(choicesFor({ trip: loose, date: THU, plan: { ...d.plan, choices: [] }, pois: poisOf(world), planArgs: argsOf() }), []);
  // 選下去：B 在 A 的原位置、那天釘住
  const after = afterOf(cx);
  assert.equal(after.pinned, true);
  assert.deepEqual(ids(after), before.map((id) => (id === ca.id ? cx.id : id)));
});

// ---- 換一家不動到別天（11-24；跟升級成站同一個道理，engine/trip.js planTrip 的 lateIds）----
// 引擎每天挑插站的名單是「先扣掉不拿的店、再取最近的幾家」：他換了一家，不拿的店多一家（B）少一家（A），別天的名單就遞補、行程跟著變。
// 改之前三個打包檔實跑（每份換一家清單的每一筆沒帶小標的候選各選一次）：七天包 35 次裡 8 次、試走版 51 次裡 6 次別天的引擎站跟著變
// （例：試走版 8/17 把 TRUE VINTAGE. 換成 SQUAT，引擎把 TRUE VINTAGE. 自己排到 8/13）；改之後都是 0 次。
const { heldSwaps } = await import('../../src/engine/choices.js');
const { corridorPickIds } = await import('../../src/engine/insert.js');
const { pickedOrRemoved, corridorExclude } = await import('../../src/engine/trip.js');
const ONLY_THU = { ...Object.fromEntries(DAYS.map((k) => [k, []])), thu: [['09:00', '23:00']] };

test('換一家的記號：換掉的 A 那筆 swapped 記 hold；換進來的 B 原本哪一天都沒勾就記 via swap、原本是他勾的（別天挪過來的）不記；A 是後來才加進來的勾選時 hold 那筆一起記 via', () => {
  const ca = cafe('咖啡甲'); const cb = cafe('咖啡乙'); const cc = cafe('咖啡丙'); const cd = cafe('咖啡丁');
  const world = [A, B, ca, cb, cc, cd];
  const trip = tripOf([{ date: THU, picks: want(A.id, ca.id) }, { date: FRI, picks: want(B.id, cc.id) }]);
  const thu = run(trip, world).days[0].plan;
  // (1) B 哪一天都還沒排
  const t1 = swapInPlace({ trip, date: THU, fromPoiId: ca.id, toPoi: cb, plan: thu, pois: poisOf(world), at: AT });
  assert.deepEqual(dayOf(t1, THU).picks, [{ poiId: A.id, priority: 'want' }, { poiId: cb.id, priority: 'want', via: 'swap' }]);
  assert.deepEqual(dayOf(t1, THU).swapped, [{ from: ca.id, to: cb.id, at: AT, hold: true }]);
  assert.deepEqual([[...heldSwaps(t1).pre], [...heldSwaps(t1).late]], [[ca.id], []]);
  assert.equal(dayOf(t1, THU).removed, undefined, '不是「不去了」：不留拒絕紀錄');
  // 引擎挑別天的名單時：B 改成「挑好才拿掉」（跟升級進來的勾選同一種），A 照舊一開始就扣掉
  assert.ok(pickedOrRemoved(t1).has(cb.id) && !pickedOrRemoved(t1, { skipLate: true }).has(cb.id) && corridorPickIds(t1).has(cb.id));
  // A 只是引擎不會自己排到別天；走廊清單、換一家清單照舊可以再出現（原話 #138「有出現但我沒選擇，還是可以再次出現」）
  assert.ok(!corridorExclude(t1).has(ca.id) && !pickedOrRemoved(t1).has(ca.id));
  // (2) B 原本是他別天勾的：挪過來，不記 via（它本來就是一開始就扣掉的）
  const t2 = swapInPlace({ trip, date: THU, fromPoiId: ca.id, toPoi: cc, plan: thu, pois: poisOf(world), at: AT });
  assert.deepEqual(dayOf(t2, THU).picks, [{ poiId: A.id, priority: 'want' }, { poiId: cc.id, priority: 'want' }]);
  assert.deepEqual(dayOf(t2, FRI).picks, want(B.id));
  assert.ok(pickedOrRemoved(t2, { skipLate: true }).has(cc.id));
  // (3) 接著把剛換進來的 B 再換掉：B 那筆是後來才加進來的，hold 那筆一起記 via；A 還是 pre
  const t3 = swapInPlace({ trip: t1, date: THU, fromPoiId: cb.id, toPoi: cd, plan: run(t1, world).days[0].plan, pois: poisOf(world), at: AT });
  assert.deepEqual(dayOf(t3, THU).swapped, [{ from: ca.id, to: cb.id, at: AT, hold: true }, { from: cb.id, to: cd.id, at: AT, hold: true, via: 'swap' }]);
  assert.deepEqual([[...heldSwaps(t3).pre], [...heldSwaps(t3).late]], [[ca.id], [cb.id]]);
  assert.deepEqual(dayOf(t3, THU).picks.at(-1), { poiId: cd.id, priority: 'want', via: 'swap' });
  // (4) A 是升級進來的勾選（via corridor）、B 是別天挪過來的：B 不沿用 A 的記號，A 那筆 hold 記 via corridor
  const up = tripOf([{ date: THU, picks: [{ poiId: A.id, priority: 'want' }, { poiId: ca.id, priority: 'want', via: 'corridor' }] }, { date: FRI, picks: want(B.id, cc.id) }]);
  const t4 = swapInPlace({ trip: up, date: THU, fromPoiId: ca.id, toPoi: cc, plan: run(up, world).days[0].plan, pois: poisOf(world), at: AT });
  assert.deepEqual(dayOf(t4, THU).picks, [{ poiId: A.id, priority: 'want' }, { poiId: cc.id, priority: 'want' }]);
  assert.deepEqual(dayOf(t4, THU).swapped, [{ from: ca.id, to: cc.id, at: AT, hold: true, via: 'corridor' }]);
  assert.deepEqual([[...heldSwaps(t4).pre], [...heldSwaps(t4).late]], [[], [ca.id]]);
  // 沒有 hold 的舊紀錄不算（照舊只管被換掉的那一天）
  assert.deepEqual([...heldSwaps(tripOf([{ date: THU, picks: want(cb.id), swapped: [{ from: ca.id, to: cb.id, at: AT }] }])).pre], []);
  assert.deepEqual([heldSwaps(null).pre.size, heldSwaps({}).late.size], [0, 0]);
});

test('換一家不動到別天：換掉的 A 引擎不會自己排到別天、換進來的 B 不讓別天的名單遞補——別天逐站相同（之前 A 一放出來就被排進別天的空檔）', () => {
  // 8/14：第一站只開到 11:00、第二站 12:00 才開，中間的空檔引擎會填咖啡廳。池子的先後：咖啡甲（他 8/13 勾的）、咖啡乙（只有週四開，8/14 用不到）、咖啡丙
  const first = mk('早的', { hours: daily('09:00', '11:00') }); const late = mk('晚開', { hours: daily('12:00', '23:00') });
  const ca = cafe('咖啡甲', { dwellMin: 40 }); const cb = cafe('咖啡乙', { dwellMin: 40, hours: ONLY_THU }); const cx = cafe('咖啡丙', { dwellMin: 40 });
  const world = [A, first, late, ca, cb, cx];
  const pool = [ca, cb, cx];
  const trip = tripOf([{ date: THU, picks: want(A.id, ca.id) }, { date: FRI, picks: want(first.id, late.id) }]);
  const before = run(trip, world, pool);
  const fri = (r) => r.days[1].plan.sequence.map((s) => [s.poi.id, s.insertedBy ?? null, s.startMin, s.endMin]);
  assert.deepEqual(ids(before.days[1].plan), [first.id, cx.id, late.id], '換之前：8/14 的空檔填的是咖啡丙（咖啡甲是他勾的、不拿）');
  assert.ok(!before.days.some((d) => ids(d.plan).includes(cb.id)), '咖啡乙哪一天都還沒排');
  const swapped = swapInPlace({ trip, date: THU, fromPoiId: ca.id, toPoi: cb, plan: before.days[0].plan, pois: poisOf(world), at: AT });
  const after = run(swapped, world, pool);
  assert.deepEqual(ids(after.days[0].plan), [A.id, cb.id], '8/13：原位置換掉');
  assert.deepEqual(fri(after), fri(before), `8/14 逐站、逐時刻相同：${ids(after.days[1].plan).join('→')}`);
  // 交回引擎重排 8/13 之後也一樣：換掉的那家還是不會被引擎排到別天
  const handedBack = { ...swapped, days: swapped.days.map((d) => (d.date === THU ? (({ pinned: _p, ...rest }) => rest)(d) : d)) };
  assert.deepEqual(fri(run(handedBack, world, pool)), fri(before));
  // 對照：沒有 hold 記號的舊紀錄（上一版存下來的換一家）照舊——換掉的店別天可以被引擎拿去填空檔
  const legacy = { ...swapped, days: swapped.days.map((d) => (d.date === THU ? { ...d, swapped: d.swapped.map(({ hold: _h, ...x }) => x) } : d)) };
  assert.ok(ids(run(legacy, world, pool).days[1].plan).includes(ca.id), '舊紀錄的行為不變');
});

// ---- 挪別天已排的店，它原本那天不整天重排（11-24 傍晚主控裁決「甲1」；推導、待收口）----
// 依據：原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」的類推——他只動了一站，別的站不該跟著動；他調過的留著、要交回引擎由他按（總則 6）。
// 之前原本那天沒釘住就整天重新搜尋：對抗審查在七天包量每一筆帶小標的候選（65 次）——那天除了少掉那家還有別的變 56 次、他勾的站先後變了 27 次、
// 他勾的另一站掉進排不進 5 次、連第三天也變 19 次（例：8/15 竹屋換成 かけはし〔8/12（三）已排〕，8/12 的順序從 Loft、Art Sports、Yodobashi、司、唐吉訶德、かけはし
// 變成 司、唐吉訶德、Loft、Yodobashi、Art Sports）。原本那天先釘住再選的 113 次，別天 0 次跟著變。
// 做法：swapInPlace 多收 baseline（當下每天畫面上的 plan）——那家在原本那天的行程裡（他勾的排進去的、引擎排的）而那天還沒釘住，就先照畫面上這一版釘住再把那一筆拿掉；
// 只是「勾了沒排進」的（畫面上沒有站要動）只拿掉勾選，pinIdle 給了才釘（畫面先不釘、重排後整趟不一樣才補釘——ui/app.js swapStop）。
const fillWorld = () => {
  const first = mk('早的', { hours: daily('09:00', '11:00') }); const late = mk('晚開', { hours: daily('12:00', '23:00') });
  const first2 = mk('早的二', { hours: daily('09:00', '11:00') }); const late2 = mk('晚開二', { hours: daily('12:00', '23:00') });
  const fill = cafe('咖啡廳', { dwellMin: 70 }); const fill2 = cafe('咖啡廳二', { dwellMin: 70 });
  const world = [A, C, first, late, first2, late2, fill, fill2];
  // THU 兩個街區；FRI、SAT 各有一段等開門的空檔（第一站只開到 11:00、第二站 12:00 才開），引擎各填一家咖啡廳：池子照順序是咖啡廳、咖啡廳二
  const trip = tripOf([{ date: THU, picks: want(A.id, C.id) }, { date: FRI, picks: want(first.id, late.id) }, { date: SAT, earlyDay: true, departHM: '09:00', picks: want(first2.id, late2.id) }]);
  return { first, late, first2, late2, fill, fill2, world, pool: [fill, fill2], trip };
};
const timed = (plan) => plan.sequence.map((s) => [s.poi.id, s.insertedBy ?? null, s.startMin, s.endMin]);

test('挪別天他勾的站：原本那天先照畫面上這一版釘住、那一筆原位置拿掉——其餘各站（含引擎排的）與先後不變，引擎不替那天補站或撤站；第三天逐站逐時刻不變（之前那天整天重新搜尋，引擎排的站跟著變、連後面的日子也變）', () => {
  const { first, late, first2, late2, fill, fill2, world, pool, trip } = fillWorld();
  const before = run(trip, world, pool);
  assert.deepEqual([ids(before.days[1].plan), ids(before.days[2].plan)], [[first.id, fill.id, late.id], [first2.id, fill2.id, late2.id]], '換之前：FRI 的空檔填咖啡廳、SAT 填咖啡廳二');
  const args = { trip, date: THU, fromPoiId: C.id, toPoi: late, plan: before.days[0].plan, pois: poisOf(world), at: AT };
  // 對照——沒給 baseline（舊的做法：只拿掉勾選）：FRI 整天重新搜尋，沒有等開門的空檔了、引擎不再填咖啡廳；SAT 的咖啡廳二跟著換成咖啡廳
  const loose = run(swapInPlace(args), world, pool);
  assert.deepEqual([ids(loose.days[1].plan), ids(loose.days[2].plan)], [[first.id], [first2.id, fill.id, late2.id]], '舊的做法：原本那天與第三天都跟著變');
  // 給了 baseline：FRI 先照畫面釘住，再把「晚開」那一筆拿掉
  const next = swapInPlace({ ...args, baseline: before });
  const fri = dayOf(next, FRI);
  assert.deepEqual(fri.picks, want(first.id), '那天的勾選拿掉（不是不去了）');
  assert.deepEqual([fri.removed, fri.swapped], [undefined, undefined], '不留拒絕或換掉的紀錄');
  assert.deepEqual(fri.pinned, { at: AT, sequence: pinEntriesOf(before.days[1].plan.sequence, FRI).filter((e) => e.poiId !== late.id) }, '那天釘住：畫面上那一版少掉那一筆，引擎排的咖啡廳照原樣記著');
  assert.equal(dayOf(next, SAT), dayOf(trip, SAT), '第三天的旅程檔原物件');
  assert.equal(dayOf(trip, FRI).pinned, undefined, '不改傳入的');
  const after = run(next, world, pool);
  assert.deepEqual(ids(after.days[0].plan), [A.id, late.id], 'THU：原位置換掉');
  assert.deepEqual(ids(after.days[1].plan), [first.id, fill.id], 'FRI：原順序少掉那一家，引擎排的咖啡廳還在');
  assert.equal(after.days[1].plan.pinned, true);
  assert.deepEqual(timed(after.days[1].plan), timed(before.days[1].plan).slice(0, 2), 'FRI 排在它前面的各站時刻不動');
  assert.deepEqual(timed(after.days[2].plan), timed(before.days[2].plan), 'SAT 逐站、逐時刻不變');
  assert.deepEqual(after.days.flatMap((d) => d.plan.dropped), [], '每一天他勾的站一站不少');
  // 原本那天本來就釘住：照舊只在那條順序上拿掉那一筆（at 不重寫）
  const pinnedTrip = { ...trip, days: trip.days.map((d) => (d.date === FRI ? { ...d, pinned: { at: 'old', sequence: pinEntriesOf(before.days[1].plan.sequence, FRI) } } : d)) };
  const base2 = run(pinnedTrip, world, pool);
  const next2 = swapInPlace({ ...args, trip: pinnedTrip, plan: base2.days[0].plan, baseline: base2 });
  assert.deepEqual([dayOf(next2, FRI).pinned.at, dayOf(next2, FRI).pinned.sequence.map((e) => e.poiId)], ['old', [first.id, fill.id]]);
  assert.deepEqual(timed(run(next2, world, pool).days[2].plan), timed(before.days[2].plan));
  // baseline 沒有那一天的 plan（只排了幾天）：沒得釘，退回只拿掉勾選
  const partial = swapInPlace({ ...args, baseline: { days: [before.days[0], { date: FRI, plan: null }] } });
  assert.deepEqual([dayOf(partial, FRI).pinned, dayOf(partial, FRI).picks], [undefined, want(first.id)]);
});

test('挪別天引擎排的站：原本那天一樣先照畫面釘住，記著的那一筆引擎站標成不排（off）——那天其餘各站不變、引擎不補別家，別天照樣不拿它；同一處的另一筆也算', () => {
  const { first, late, first2, late2, fill, fill2, world, pool, trip } = fillWorld();
  const before = run(trip, world, pool);
  const next = swapInPlace({ trip, date: THU, fromPoiId: C.id, toPoi: fill, plan: before.days[0].plan, pois: poisOf(world), at: AT, baseline: before });
  const fri = dayOf(next, FRI);
  assert.deepEqual(fri.picks, want(first.id, late.id), '引擎排的站不在勾選裡：勾選不動');
  assert.deepEqual(fri.pinned.sequence.map((e) => [e.poiId, e.insertedBy ?? null, e.off ?? false]), [[first.id, null, false], [fill.id, 'engine', true], [late.id, null, false]], '那天釘住；咖啡廳那一筆記著但不排');
  assert.deepEqual(dayOf(next, THU).picks.at(-1), { poiId: fill.id, priority: 'want', via: 'swap' });
  const after = run(next, world, pool);
  assert.deepEqual([ids(after.days[0].plan), ids(after.days[1].plan)], [[A.id, fill.id], [first.id, late.id]], 'FRI 少掉那一家、引擎沒有另外補（咖啡廳二還是 SAT 的）');
  assert.deepEqual(timed(after.days[2].plan), timed(before.days[2].plan), 'SAT 逐站、逐時刻不變');
  assert.ok(fill2.id && first2.id && late2.id);
  // 同一處的另一筆：他要換進來的是「咖啡廳本館」，FRI 引擎排的是同一處的「咖啡廳」——那一筆一樣標成不排，不會兩天各去一次
  const main = cafe('咖啡廳本館', { dwellMin: 70, samePlace: fill.id });
  const w2 = [...world, main];
  const b2 = run(trip, w2, pool);
  assert.deepEqual(ids(b2.days[1].plan), [first.id, fill.id, late.id]);
  const n2 = swapInPlace({ trip, date: THU, fromPoiId: C.id, toPoi: main, plan: b2.days[0].plan, pois: poisOf(w2), at: AT, baseline: b2 });
  assert.deepEqual(dayOf(n2, FRI).pinned.sequence.filter((e) => e.off).map((e) => e.poiId), [fill.id]);
  const a2 = run(n2, w2, pool);
  assert.deepEqual([ids(a2.days[0].plan), ids(a2.days[1].plan)], [[A.id, main.id], [first.id, late.id]]);
  assert.deepEqual(timed(a2.days[2].plan), timed(b2.days[2].plan));
});

test('挪別天「勾了沒排進」的那一筆：畫面上沒有站要動，只拿掉勾選、那天不釘住；pinIdle 給了才照畫面釘住（重排後整趟不一樣時畫面才補這一步）', () => {
  // FRI 勾三家咖啡廳（不是主題日，同類一天最多 2 家）：有一家排不進
  const c1 = cafe('咖啡一', { my: { rating: 5 } }); const c2 = cafe('咖啡二', { my: { rating: 5 } }); const c3 = cafe('咖啡三'); const cx = cafe('咖啡甲');
  const world = [A, B, c1, c2, c3, cx];
  const trip = tripOf([{ date: THU, picks: want(A.id, cx.id) }, { date: FRI, picks: want(B.id, c1.id, c2.id, c3.id) }]);
  const before = run(trip, world);
  assert.deepEqual(before.days[1].plan.dropped.map((x) => x.poi.id), [c3.id]);
  const args = { trip, date: THU, fromPoiId: cx.id, toPoi: c3, plan: before.days[0].plan, pois: poisOf(world), at: AT, baseline: before };
  const next = swapInPlace(args);
  assert.deepEqual([dayOf(next, FRI).picks, dayOf(next, FRI).pinned], [want(B.id, c1.id, c2.id), undefined], '只拿掉勾選，不釘住');
  const after = run(next, world);
  assert.deepEqual([ids(after.days[0].plan), timed(after.days[1].plan), after.days[1].plan.pinned ?? false], [[A.id, c3.id], timed(before.days[1].plan), false], 'FRI 逐站逐時刻相同、也沒釘住');
  const forced = swapInPlace({ ...args, pinIdle: true });
  assert.deepEqual(dayOf(forced, FRI).pinned, { at: AT, sequence: pinEntriesOf(before.days[1].plan.sequence, FRI) }, 'pinIdle：照畫面上那一版釘住（那一家本來就不在順序裡）');
  assert.deepEqual(dayOf(forced, FRI).picks, want(B.id, c1.id, c2.id));
  assert.deepEqual(timed(run(forced, world).days[1].plan), timed(before.days[1].plan));
});

test('清單列帶小標的候選之前，原本那天也一起試排（pinnedSwapCheck 收 baseline）：拿掉那一筆會害那天別的站排不進的不列', () => {
  // FRI：甲地 → 中繼站 → 乙地。甲地直接走到乙地要 200 分（中繼站在中間，各 5 分）；乙地 13:00 關——少了中繼站，乙地就趕不上
  const p1 = mk('甲地'); const hub = mk('中繼站'); const p2 = mk('乙地', { hours: daily('09:00', '13:00') });
  const world = [A, C, p1, hub, p2];
  const farLeg = (a, b) => ({ walkMin: (a.id === p1.id && b.id === p2.id) || (a.id === p2.id && b.id === p1.id) ? 200 : 5, rideMin: 0, climbMin: 0, mode: 'walk' });
  const pinnedFri = { at: AT, sequence: [p1.id, hub.id, p2.id].map((poiId) => ({ poiId })) };
  const trip = tripOf([{ date: THU, picks: want(A.id, C.id) }, { date: FRI, picks: want(p1.id, hub.id, p2.id), pinned: pinnedFri }]);
  const args = { rules, settings, country: COUNTRY, kb, legFn: farLeg, restPool: [] };
  const before = planTrip({ trip, pois: poisOf(world), ...args });
  assert.deepEqual([ids(before.days[1].plan), before.days[1].plan.dropped], [[p1.id, hub.id, p2.id], []]);
  const check = (leg) => pinnedSwapCheck({ trip, date: THU, fromPoiId: C.id, plan: before.days[0].plan, pois: poisOf(world), planArgs: { ...args, legFn: leg }, baseline: before });
  assert.equal(check(farLeg)(hub), false, '少了中繼站，乙地排不進：不列');
  assert.equal(check(legFn)(hub), true, '每段都 5 分：拿掉中繼站沒事，照列');
  assert.equal(pinnedSwapCheck({ trip, date: THU, fromPoiId: C.id, plan: before.days[0].plan, pois: poisOf(world), planArgs: args })(hub), true, '沒給 baseline：只試這一天（舊呼叫端）');
  // 說不列的那一家真的選下去：乙地落到那天的排不進清單（這就是要擋的事）
  const blind = planTrip({ trip: swapInPlace({ trip, date: THU, fromPoiId: C.id, toPoi: hub, plan: before.days[0].plan, pois: poisOf(world), at: AT, baseline: before }), pois: poisOf(world), ...args });
  assert.deepEqual(blind.days[1].plan.dropped.map((x) => x.poi.id), [p2.id]);
});
