// 早餐（engine/breakfast.js；11-06 第二批，原話 #196「還有預設上每天都要有早餐的安排 但我也有可能在飯店吃早餐 所以早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」、
// #197「所以某一天的早餐我在飯店吃了 原定的早餐沒去到 後續的其中一天在不影響原定行程的前提下 可以再推薦我一次」）：
// 國家層有早餐段才啟動；引擎替他挑一家安插成第一站（原本的站都留著、先後不變）；排不進就不排、只提示；整趟一家店只當一天的早餐；
// 吃飯店早餐／改天去／改回來／按了「或 X」／早餐換一家，都是回新 trip 的純函式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, breakfastLaterDays } from '../../src/engine/trip.js';
import {
  breakfastChoiceOf, servesBreakfast, breakfastStop, isPlacedBreakfast, breakfastOfPlan, breakfastKind, alignBreakfast, tryBreakfastFirst, breakfastOptions, assignBreakfasts,
  breakfastOffers, breakfastFitDays, breakfastSwapCandidates, setBreakfast, clearBreakfast, swapBreakfast, takeBreakfastOffer, rememberedBreakfasts, blockedBreakfasts, breakfastKeepOf, keepBreakfasts, BREAKFAST_PRIORITY,
} from '../../src/engine/breakfast.js';
import { isChoiceStop } from '../../src/engine/choices.js';
import { engineMayInsert } from '../../src/engine/trip.js';
import { PRIORITY_VALUE } from '../../src/engine/core.js';
import { loadRules } from '../../src/rules/index.js';
import { BUILTIN } from '../../src/rules/builtin.js';
import rulesJson from '../../src/rules.json' with { type: 'json' };

const rules = loadRules(BUILTIN, rulesJson.rules);
const settings = rulesJson.settings;
// 夏季月份留空：這些小世界不測「夏天中午會曬」，免得順延幾分鐘就多一條不相干的罰
const BASE_COUNTRY = { mealSlots: { lunch: ['11:30', '13:30'], dinner: ['18:00', '20:30'] }, nightSlot: ['20:00', '24:00'], climate: { summerMonths: [] }, utcOffsetMin: 540 };
const JP = { ...BASE_COUNTRY, mealSlots: { breakfast: ['07:00', '10:00'], ...BASE_COUNTRY.mealSlots } };
const kb = { zones: { town: { environment: 'town', lat: 38.26, lng: 140.87 } } };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const daily = (open, close, only = DAYS) => Object.fromEntries(only.map((k) => [k, [[open, close]]]));
const mk = (id, over = {}) => ({ id, name_zh: id, category: 'street', walkFactor: 1, recovery: false, cafeLike: false, climbMin: 0, zoneId: 'town', hours: daily('09:00', '23:00'), dwellMin: 60, daylightOnly: false, lat: 38.26, lng: 140.87, my: {}, ...over });
/** 能當早餐的店：預設每天 07:00–22:00、停 20 分、吃的類 */
const eat = (id, over = {}) => mk(id, { category: 'food', walkFactor: 0, recovery: true, dwellMin: 20, hours: daily('07:00', '22:00'), meals: { breakfast: `${id}的早餐`, lunch: true }, ...over });
const home = { id: 'home', name_zh: '飯店', zoneId: 'town', lat: 38.26, lng: 140.87 };
/** 走路分鐘查表（兩個 id 用 | 接，不分方向），沒寫的 5 分；RIDE 裡的那幾段要搭車 */
const makeLeg = (walk = {}, ride = {}) => (a, b) => {
  const key = [`${a.id}|${b.id}`, `${b.id}|${a.id}`];
  const r = ride[key[0]] ?? ride[key[1]];
  if (r) return { walkMin: 5, rideMin: r, climbMin: 0, mode: 'ride' };
  return { walkMin: walk[key[0]] ?? walk[key[1]] ?? 5, rideMin: 0, climbMin: 0, mode: 'walk' };
};
const flat = makeLeg();
const THU = '2026-08-13'; const FRI = '2026-08-14'; const SAT = '2026-08-15'; const SUN = '2026-08-16';
const ids = (plan) => plan.sequence.map((s) => s.poi.id);
const rest = (plan) => plan.sequence.filter((s) => !isPlacedBreakfast(s));
const times = (list) => list.map((s) => `${s.poi.id}@${s.startMin}-${s.endMin}`);
const hinted = (plan) => plan.warnings.filter((w) => w.ruleId === 'breakfast-slot');
const hotelAll = (trip) => ({ ...trip, days: trip.days.map((d) => ({ ...d, breakfast: { mode: 'hotel', poiId: null } })) });
const run = (trip, pool, { country = JP, legFn = flat, s = settings } = {}) => {
  const picked = trip.days.flatMap((d) => (d.picks ?? []).map((p) => p.poiId));
  const all = [...pool, ...WORLD.filter((p) => !pool.some((q) => q.id === p.id))];
  const pois = Object.fromEntries(all.filter((p) => picked.includes(p.id) || pool.includes(p)).map((p) => [p.id, p]));
  return planTrip({ trip, pois, rules, settings: s, country, kb, legFn, restPool: pool });
};
const tripOf = (days) => ({ id: 't', party: 1, homeBases: [{ poi: home }], days: days.map((d) => ({ type: 'normal', ...d })) });
const want = (...list) => list.map((id) => ({ poiId: id, priority: 'want' }));

// 他勾的站：早上的街區（09:00 開）、午餐、下午的街區、晚餐
const A = mk('街區A'); const B = mk('街區B'); const C = mk('街區C');
const lunch = mk('午餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('11:30', '14:30'), dwellMin: 60, meals: { lunch: true } });
const dinner = mk('晚餐店', { category: 'food', walkFactor: 0, recovery: true, hours: daily('17:30', '22:00'), dwellMin: 60, meals: { dinner: true } });
const noodle = eat('麵店'); const stand = eat('站內店'); const bakery = eat('麵包店');
const WORLD = [A, B, C, lunch, dinner, noodle, stand, bakery];
const dayPicks = want(A.id, lunch.id, B.id, dinner.id);

test('國家層沒有早餐段：整套不動作（不排、不提示、能當早餐的店照舊可以當填站）；有早餐段：要早餐的日子引擎挑一家安插成第一站，原本的站都在、先後不變、時刻順延', () => {
  const trip = tripOf([{ date: THU, picks: dayPicks }]);
  const off = run(trip, [noodle], { country: BASE_COUNTRY }).days[0];
  assert.ok(!off.plan.sequence.some((s) => s.priority === BREAKFAST_PRIORITY), '沒有早餐段就沒有引擎排的早餐');
  assert.deepEqual(hinted(off.plan), []);
  assert.equal(off.day.breakfast, null);
  assert.deepEqual(off.plan.breakfastOffers, []);
  assert.equal(off.plan.meals.breakfast, null);

  const on = run(trip, [noodle]).days[0];
  const none = run(hotelAll(trip), [noodle]).days[0];   // 同一天按了「吃飯店早餐」＝沒有早餐的樣子
  const b = on.plan.sequence[0];
  assert.equal(b.poi.id, noodle.id, `早餐排在第一站：${ids(on.plan).join('→')}`);
  assert.deepEqual([b.priority, b.insertedBy, b.optional, b.designated, b.isAnchor, b.fixedWindow, b.gap], [BREAKFAST_PRIORITY, 'engine', true, false, false, null, null]);
  assert.equal(b.dwellMin, 20, '停留用店自己的');
  assert.equal(b.startMin, 9 * 60 + 5, '09:00 出門、走 5 分');
  assert.ok(Number.isFinite(b.detourMin));
  assert.equal(on.plan.meals.breakfast, noodle.id);
  assert.equal(breakfastOfPlan(on.plan), b);
  assert.equal(breakfastKind(b), 'engine');
  assert.deepEqual(ids({ sequence: rest(on.plan) }), ids(none.plan), '其餘各站跟沒有早餐時同一批、同一個先後');
  assert.deepEqual(on.plan.dropped, none.plan.dropped);
  for (const s of rest(on.plan)) assert.ok(s.startMin >= none.plan.sequence.find((x) => x.poi.id === s.poi.id).startMin, `${s.poi.id} 只會往後順延`);
  assert.deepEqual(hinted(on.plan), [], '排到了就沒有提示');
  assert.ok(on.plan.complete);
  assert.equal(PRIORITY_VALUE.breakfast, 0, '引擎排的早餐自己沒有價值，值多少由 breakfast-slot 的缺席罰分表達');
});

test('不要早餐的日子不排：早餐段不在當天時窗內（晚出門日、傍晚才到的抵達日）；被固定時段蓋住；他說這天不排', () => {
  const late = tripOf([{ date: THU, picks: dayPicks }, { date: FRI, picks: dayPicks }, { date: SAT, picks: dayPicks }]);   // 第三天起 11:00 出門
  const r = run(late, [noodle, stand, bakery]);
  assert.ok(r.days[0].plan.meals.breakfast && r.days[1].plan.meals.breakfast);
  assert.equal(r.days[2].plan.meals.breakfast, null, '晚出門日（11:00 起）時窗蓋不到早餐段');
  assert.deepEqual(hinted(r.days[2].plan), [], '不要早餐的日子不提示');
  const arrival = tripOf([{ date: THU, type: 'arrival', arriveMin: 16 * 60, picks: want(dinner.id) }]);
  assert.equal(run(arrival, [noodle]).days[0].plan.meals.breakfast, null);
  // 08:30 就開始、開到下午的研討會（從早餐段開始前就在進行、到過半還沒散）蓋住早餐……07:00 前開始才算蓋住；08:50 才卡位的不算，那種日子只是排不進
  const venue = mk('會場', { category: 'venue', walkFactor: 0, hours: daily('06:00', '20:00') });
  const fixed = (startMin) => tripOf([{ date: THU, type: 'fixed', earlyDay: true, departHM: '06:00', picks: [{ poiId: venue.id, priority: 'must', fixedWindow: { startMin, endMin: 17 * 60, arriveEarlyMin: 0, afterMin: 0 } }] }]);
  const covered = run(fixed(6 * 60 + 30), [noodle, venue]).days[0];
  assert.equal(covered.plan.meals.breakfast, null);
  assert.deepEqual(hinted(covered.plan), [], '被固定時段蓋住：不要早餐、不提示');
});

test('他勾的站裡已經有一站算早餐就不另排（plan.meals.breakfast 是它，kind picked）；同一處的另一筆（samePlace）別天引擎也不拿', () => {
  const marketA = eat('朝市A', { hours: daily('07:00', '10:30'), dwellMin: 40 });   // 10:30 就關：只能排在一早
  const marketB = eat('朝市B', { samePlace: marketA.id });
  const trip = tripOf([{ date: THU, picks: [...want(marketA.id), ...dayPicks] }, { date: FRI, picks: dayPicks }]);
  const pois = [marketA, marketB, noodle];
  const r = planTrip({ trip, pois: Object.fromEntries([...WORLD, ...pois].map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: makeLeg({ 'home|麵店': 9 }), restPool: [marketB, noodle] });
  const d1 = r.days[0].plan; const d2 = r.days[1].plan;
  assert.equal(d1.meals.breakfast, marketA.id);
  assert.equal(breakfastKind(breakfastOfPlan(d1)), 'picked');
  assert.ok(!d1.sequence.some((s) => s.insertedBy === 'engine' && s.priority === BREAKFAST_PRIORITY), '他勾的站裡有早餐了，引擎不另排');
  assert.equal(d2.meals.breakfast, noodle.id, `朝市B 跟他勾的朝市A 是同一處，不拿；拿比較遠的麵店：${ids(d2).join('→')}`);
  assert.ok(!r.days.some((x) => ids(x.plan).includes(marketB.id)));
  // 他勾的那一筆不是當早餐去的（中午才開）：同一處的另一筆照樣不拿——同一個地方不排兩次
  const noonMarket = eat('朝市午場', { hours: daily('11:00', '15:00'), dwellMin: 40, meals: { lunch: true } });
  const twin = eat('朝市午場的另一筆', { samePlace: noonMarket.id });
  const trip2 = tripOf([{ date: THU, picks: [...want(noonMarket.id), ...want(A.id, dinner.id)] }, { date: FRI, picks: want(B.id, lunch.id) }]);
  const r2 = planTrip({ trip: trip2, pois: Object.fromEntries([...WORLD, noonMarket, twin].map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: makeLeg({ 'home|麵店': 9 }), restPool: [twin, noodle, stand] });
  assert.ok(ids(r2.days[0].plan).includes(noonMarket.id) && r2.days[0].plan.meals.breakfast !== noonMarket.id, '朝市午場在行程裡、不是早餐');
  assert.ok(!r2.days.some((x) => ids(x.plan).includes(twin.id)), `同一處的另一筆沒被拿去當早餐：${r2.days.map((x) => x.plan.meals.breakfast).join('、')}`);
  assert.ok(r2.days.every((x) => x.plan.meals.breakfast), '兩天都另外排到早餐');
});

test('引擎挑早餐的門：能當早餐、過引擎插站的門、有營業時間而且那時開著、走得到、離住宿近或順路、在場的人不避；不符合的那天不排、出一句提示', () => {
  const trip = tripOf([{ date: THU, picks: dayPicks }]);
  const none = (pool, opt, why) => {
    const d = run(trip, pool, opt).days[0];
    assert.equal(d.plan.meals.breakfast, null, why);
    assert.equal(hinted(d.plan).length, 1, `${why}：要有提示`);
  };
  none([eat('只有午餐', { meals: { lunch: true } })], {}, '不能當早餐（meals 沒列 breakfast）');
  none([eat('沒標', { meals: undefined })], {}, '沒有 meals 欄位：推導不給早餐');
  none([eat('可略過', { researchSkip: '查過不用去' })], {}, '研究判可略過');
  none([eat('未解鎖', { unlockWhen: '同品類吃無可吃' })], {}, '還沒解鎖');
  none([eat('挖寶型', { curated: false })], {}, '挖寶型');
  none([eat('代購站', { item: '香水' })], {}, '代購研究站');
  none([eat('不是地點', { notAStop: true })], {}, '不是一個地點');
  none([eat('時段不明', { hours: null })], {}, '沒有營業時間資料：不知道開不開的不排');
  none([eat('今天休', { closedDates: [THU] })], {}, '那天不開（closedDates）');
  none([eat('週日才開', { hours: daily('07:00', '22:00', ['sun']) })], {}, '那天不開（星期）');
  none([eat('十點半才開', { hours: daily('10:30', '22:00') })], {}, '出門的時候還沒開，等它開門整天都要往後推');
  none([eat('很快就關', { hours: daily('07:00', '09:15') })], {}, '到了待不完就關門');
  none([eat('要搭車')], { legFn: makeLeg({}, { 'home|要搭車': 20 }) }, '要搭車才到得了');
  none([eat('太遠')], { legFn: makeLeg({ 'home|太遠': 20, '太遠|街區A': 20 }) }, '離住宿走 20 分、也不順路');
  const avoid = { ...trip, persons: [{ id: 'me', isMe: true, adjustments: {} }, { id: 'p1', name: '同行', adjustments: { avoidCategories: ['food'] } }] };
  assert.equal(run(trip, [noodle]).days[0].plan.meals.breakfast, noodle.id, '對照：沒有同行者時排得進');
  assert.equal(run(avoid, [noodle]).days[0].plan.meals.breakfast, null, '在場的人不想去的店型不拿');
  // 順路的：離住宿走 14 分（超過 12），但在去第一站的路上（比直接去多繞 5 分 ≤ 8）
  const morning = mk('早上的站', { hours: daily('09:00', '10:45') });   // 10:45 就關：一定排第一
  const oneMorning = tripOf([{ date: THU, picks: want(morning.id, lunch.id, dinner.id) }]);
  const wayLegs = makeLeg({ 'home|順路': 14, '順路|早上的站': 6, 'home|早上的站': 15 });
  const onTheWay = planTrip({ trip: oneMorning, pois: Object.fromEntries([morning, lunch, dinner].map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: wayLegs, restPool: [eat('順路')] }).days[0];
  assert.equal(onTheWay.plan.meals.breakfast, '順路', `順路的可以排：${ids(onTheWay.plan).join('→')}`);
  assert.equal(onTheWay.plan.sequence[0].detourMin, 5);
  assert.ok(servesBreakfast(noodle) && !servesBreakfast(lunch) && !servesBreakfast(mk('神社')));
});

test('先後：研究排序（首選→沒標→備案）→ 營業固定的在前 → 多繞的分鐘少 → 離住宿近 → 分數；備案只有沒別家可排時才用；讓這天分數比最好那家差超過 breakfastScoreSlackMin 的（不合這天）往後排、不拿掉', () => {
  const trip = tripOf([{ date: THU, picks: dayPicks }]);
  const base = run(hotelAll(trip), []).days[0];
  const args = { sequence: base.plan.sequence, complete: base.plan.complete, day: { ...base.day, breakfast: null }, home, rules, settings, country: JP, kb, mayInsert: engineMayInsert };
  const order = (pool, legFn = flat, s = settings) => breakfastOptions({ ...args, pool, legFn, settings: s }).map((o) => o.poi.id);
  const first = eat('首選', { researchRank: 'first' }); const plain = eat('沒標'); const backup = eat('備案', { researchRank: 'backup' });
  const shaky = eat('不固定', { closeRisk: 'irregular', dwellMin: 10 });
  assert.deepEqual(order([backup, shaky, plain, first]), ['首選', '沒標', '不固定', '備案'], '外帶飯糰停 10 分、分數最高，還是排在營業固定的後面');
  // 多繞的分鐘：甲在路上（多繞 0）、乙要折回來（多繞 8）
  const near = eat('近的'); const far = eat('遠的');
  assert.deepEqual(order([far, near], makeLeg({ 'home|近的': 3, '近的|街區A': 2, 'home|遠的': 6, '遠的|街區A': 7 })), ['近的', '遠的']);
  // 一樣多繞：離住宿近的在前
  assert.deepEqual(order([far, near], makeLeg({ 'home|近的': 2, '近的|街區A': 5, 'home|遠的': 4, '遠的|街區A': 3 })), ['近的', '遠的']);
  // 前面幾項都一樣：整天分數高的在前。第一站是咖啡廳的日子，坐下來吃的早餐接著它會多一條「兩個坐下來的站連著」（罰 10），外帶的不會
  const morningCafe = mk('早上的咖啡', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, hours: daily('09:00', '10:30') });
  const cafeDay = planTrip({ trip: hotelAll(tripOf([{ date: THU, picks: want(morningCafe.id, lunch.id, B.id) }])), pois: Object.fromEntries([morningCafe, lunch, B].map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: flat }).days[0];
  assert.equal(cafeDay.plan.sequence[0].poi.id, morningCafe.id);
  const seated = eat('坐著吃'); const takeaway = eat('外帶', { recovery: false });
  for (const pool of [[seated, takeaway], [takeaway, seated]]) {
    const both = breakfastOptions({ ...args, sequence: cafeDay.plan.sequence, complete: cafeDay.plan.complete, day: { ...cafeDay.day, breakfast: null }, pool, legFn: flat });
    assert.deepEqual([both[0].detourMin, both[0].walkMin], [both[1].detourMin, both[1].walkMin]);
    assert.deepEqual(both.map((o) => o.poi.id), ['外帶', '坐著吃'], `分數 ${both.map((o) => o.ev.score).join('、')}`);
    assert.equal(both[0].ev.score - both[1].ev.score, 10);
  }
  // 分數差太多的（不合這天：poor）往後排、不拿掉（11-12 審查：之前是不收，會蓋過「備案只有沒別家時才用」「排不進才不排」）：區域外的店（離圈罰 60）
  const outside = eat('區域外', { zoneId: 'elsewhere' });
  const flags = (pool, s = settings) => breakfastOptions({ ...args, pool, legFn: flat, settings: s }).map((o) => [o.poi.id, o.poor]);
  assert.deepEqual(flags([outside, plain]), [['沒標', false], ['區域外', true]], '比最好的那家差 60 分，超過 30：標成不合這天、排後面，但還在');
  assert.deepEqual(flags([outside, plain], { ...settings, breakfastScoreSlackMin: 80 }), [['沒標', false], ['區域外', false]], '門檻放寬就不算不合');
  assert.deepEqual(flags([outside, plain], { ...settings, breakfastScoreSlackMin: Infinity }), [['沒標', false], ['區域外', false]], '門檻設成無限大＝都不標');
  assert.deepEqual(flags([outside]), [['區域外', false]], '只有它一家：不算不合（只跟這天自己比）');
  // 先後多一級：備案 ＞ 不合這天 ＞ 其餘。不合這天的首選排在合適的沒標後面、但在備案前面；備案分數再高也不會把非備案標成不合
  const outFirst = eat('區域外的首選', { zoneId: 'elsewhere', researchRank: 'first' });
  assert.deepEqual(flags([backup, outFirst, plain]), [['沒標', false], ['區域外的首選', true], ['備案', false]]);
  assert.deepEqual(flags([backup, outside]), [['區域外', false], ['備案', false]], '非備案只有區域外那一家：基準是它自己，不算不合；備案（分數高 60）還是排最後');
  // 引擎真的照這個先後挑
  assert.equal(run(trip, [backup, shaky, plain]).days[0].plan.meals.breakfast, '沒標');
  assert.equal(run(trip, [backup]).days[0].plan.meals.breakfast, '備案', '只剩備案時才用它');
  assert.equal(run(trip, [backup, outside]).days[0].plan.meals.breakfast, '區域外', '排得進的非備案（就算不合這天）先於備案——主控定「備案只有沒別家時才用」');
  assert.equal(run(trip, [outside, plain]).days[0].plan.meals.breakfast, '沒標', '合適的夠分時結果跟以前一樣');
  // 同一家店兩天搶：沒搶到的那天退而求其次（用不合那天的店），不是「今天沒排早餐」——主控定「排不進才不排」
  const two = tripOf([{ date: THU, picks: dayPicks }, { date: FRI, picks: want(C.id, lunch.id, dinner.id) }]);
  const both = run(two, [plain, outside]);
  assert.deepEqual(both.days.map((x) => x.plan.meals.breakfast).sort(), ['沒標', '區域外'].sort(), `兩天各一家：${both.days.map((x) => x.plan.meals.breakfast).join('、')}`);
  assert.deepEqual(both.days.flatMap((x) => hinted(x.plan)), [], '兩天都有早餐，沒有提示');
  // assignBreakfasts 的合計：備案天數少優先，再來是不合那天的天數少
  const opt = (id, over = {}) => ({ poi: { id }, rank: 1, irregular: false, poor: false, detourMin: 0, walkMin: 5, ev: { score: 100 }, ...over });
  const pickOf = assignBreakfasts({ days: [{ date: THU, options: [opt('甲'), opt('乙', { poor: true })] }, { date: FRI, options: [opt('甲'), opt('丙', { rank: 2 })] }] });
  assert.deepEqual([pickOf.get(THU).poi.id, pickOf.get(FRI).poi.id], ['乙', '甲'], '甲給 FRI（不然 FRI 要用備案），THU 用不合那天的乙');
  // 不合那天的天數少，先於多繞的分鐘：FRI 另有一家合適但多繞 10 分的丁——甲留給 THU、FRI 用丁（多繞合計 10），不是 THU 用不合的乙換 FRI 的甲（多繞合計 0）
  const pick2 = assignBreakfasts({ days: [{ date: THU, options: [opt('甲'), opt('乙', { poor: true })] }, { date: FRI, options: [opt('甲'), opt('丁', { detourMin: 10 })] }] });
  assert.deepEqual([pick2.get(THU).poi.id, pick2.get(FRI).poi.id], ['甲', '丁']);
});

test('不能害後面的站多等開門的門（tryBreakfastFirst 的 maxAddedWaitMin；11-12 審查）：預設不開——每天預設都要有早餐（原話 #196），第一站很晚才開的日子照排；設了 settings.breakfastMaxAddedWaitMin 才擋', () => {
  // 早上沒有站、第一站 11:30 才開：早餐 09:40–10:00（挪到早餐段結束前），之後到午餐店門口等
  const trip = tripOf([{ date: THU, picks: want(lunch.id, B.id, dinner.id), removed: [{ poiId: 'x', insertedBy: 'engine', priority: 'filler' }] }]);   // 拒絕過填站：早上的空檔引擎不填
  const none = run(hotelAll(trip), [noodle]).days[0];
  assert.equal(none.plan.sequence[0].poi.id, lunch.id);
  const args = { sequence: none.plan.sequence, stop: breakfastStop(noodle, settings), day: { ...none.day, breakfast: null }, home, legFn: flat, rules, settings, country: JP, kb };
  const open = tryBreakfastFirst(args);
  assert.equal(open.ok, true);
  assert.ok(open.addedWaitMin > 60, `早餐排進去之後多等 ${open.addedWaitMin} 分`);
  assert.deepEqual([tryBreakfastFirst({ ...args, maxAddedWaitMin: 0 }).ok, tryBreakfastFirst({ ...args, maxAddedWaitMin: 0 }).why], [false, 'wait']);
  assert.equal(tryBreakfastFirst({ ...args, maxAddedWaitMin: 120 }).ok, true);
  // 預設（設定沒有這個鍵）：照排
  assert.equal(settings.breakfastMaxAddedWaitMin, undefined);
  assert.equal(run(trip, [noodle]).days[0].plan.meals.breakfast, noodle.id);
  // 設成 0：那天不排、出提示
  const gated = run(trip, [noodle], { s: { ...settings, breakfastMaxAddedWaitMin: 0 } }).days[0];
  assert.equal(gated.plan.meals.breakfast, null);
  assert.equal(hinted(gated.plan).length, 1);
  // 不多等的日子不受影響（早上有站）
  const normal = tripOf([{ date: THU, picks: dayPicks }]);
  assert.equal(run(normal, [noodle], { s: { ...settings, breakfastMaxAddedWaitMin: 0 } }).days[0].plan.meals.breakfast, noodle.id);
});

test('排不進就不排（會害後面的站撞硬規則：超過關門、趕不上固定時段）：那天一句提示「今天沒排早餐」（hint、不是黃字、不掛在哪一站），缺早餐罰 10 分；他勾的站一站都不少', () => {
  // 早上那一站 09:00 開、10:05 就關、要待 60 分：早餐一插它就待不完
  const tight = mk('只開一早', { hours: daily('09:00', '10:05') });
  const trip = tripOf([{ date: THU, picks: want(tight.id, lunch.id, B.id) }]);
  const pois = { [tight.id]: tight, [lunch.id]: lunch, [B.id]: B, [noodle.id]: noodle };
  const plan = (t) => planTrip({ trip: t, pois, rules, settings, country: JP, kb, legFn: flat, restPool: [noodle] }).days[0].plan;
  const p = plan(trip); const none = plan(hotelAll(trip));
  assert.equal(p.meals.breakfast, null);
  assert.deepEqual(ids(p), ids(none), '原本的站原封不動');
  assert.deepEqual(times(p.sequence), times(none.sequence));
  assert.deepEqual(hinted(p), [{ ruleId: 'breakfast-slot', code: 'hint', hint: true, msg: '今天沒排早餐' }]);
  assert.ok(!p.warnings.some((w) => w.ruleId === 'breakfast-slot' && w.code === 'soft'), '規則是 quiet 的，不出黃字');
  assert.equal(p.score, none.score - 10, '缺早餐罰 10（比午餐晚餐的 20 輕）；他說吃飯店的那一版不罰');
  assert.deepEqual(hinted(none), [], '他說這天不排就不提示');
  const r = tryBreakfastFirst({ sequence: none.sequence, stop: breakfastStop(noodle, settings), day: { ...planTrip({ trip, pois, rules, settings, country: JP, kb, legFn: flat }).days[0].day }, home, legFn: flat, rules, settings, country: JP, kb });
  assert.deepEqual([r.ok, r.why, r.poiId], [false, 'hard', tight.id]);
  assert.match(r.msg, /只開一早/);
});

test('填站讓位：早餐佔掉一段空檔，填站縮短（不拿掉、不超出它的空檔、不把它在等的那一站拖過開門）；giveWay none 的話同一天就排不進早餐', () => {
  // 早的 09:00–11:00、晚開 12:30 才開：中間的空檔引擎會填一家店（停留照空檔裁過）
  const early = mk('早的', { hours: daily('09:00', '11:00') });
  const late = mk('晚開', { hours: daily('12:30', '23:00') });
  const filler = mk('填空檔的店', { dwellMin: 120, walkFactor: 0 });   // 不走路的店（不然三站連著走會破走路連跑，引擎寧可等也不填）
  const trip = tripOf([{ date: THU, designated: [early.id, late.id], picks: [{ poiId: early.id, priority: 'must' }, { poiId: late.id, priority: 'must' }] }]);
  const pois = { [early.id]: early, [late.id]: late, [filler.id]: filler, [noodle.id]: noodle };
  const plan = (t) => planTrip({ trip: t, pois, rules, settings, country: JP, kb, legFn: flat, restPool: [filler, noodle] }).days[0];
  const none = plan(hotelAll(trip)); const on = plan(trip);
  const f0 = none.plan.sequence.find((s) => s.poi.id === filler.id);
  assert.ok(f0 && f0.priority === 'filler' && f0.gap, `沒有早餐時引擎填了那段空檔：${ids(none.plan).join('→')}`);
  assert.equal(on.plan.meals.breakfast, noodle.id, `早餐排得進：${ids(on.plan).join('→')}`);
  const f1 = on.plan.sequence.find((s) => s.poi.id === filler.id);
  assert.ok(f1, '填站還在');
  assert.ok(f1.dwellMin < f0.dwellMin && f1.dwellMin >= settings.fillMinGapMin, `填站縮短了：${f0.dwellMin} → ${f1.dwellMin}`);
  assert.ok(f1.endMin <= f1.gap.endMin, '沒超出它的空檔');
  assert.equal(on.plan.sequence.find((s) => s.poi.id === late.id).startMin, 12 * 60 + 30, '它在等的那一站照樣一開門就進去');
  assert.deepEqual(ids({ sequence: rest(on.plan) }), ids(none.plan));
  const strict = tryBreakfastFirst({ sequence: none.plan.sequence, stop: breakfastStop(noodle, settings), day: { ...none.day, breakfast: null }, home, legFn: flat, rules, settings, country: JP, kb, giveWay: 'none' });
  const loose = tryBreakfastFirst({ sequence: none.plan.sequence, stop: breakfastStop(noodle, settings), day: { ...none.day, breakfast: null }, home, legFn: flat, rules, settings, country: JP, kb, giveWay: 'fill' });
  assert.equal(strict.ok, false, '不讓位：填站被擠出空檔，排不進');
  assert.ok(loose.ok && loose.shrunk.length === 1 && loose.shrunk[0].poiId === filler.id && loose.displaced.length === 0);
});

test('順路站讓位（giveWay onway；預設不開）：早餐排不進時先把順路站拿掉再試，拿掉的列在 displaced；他勾的站與恢復站不讓', () => {
  const seqOf = (list) => { let t = 9 * 60; return list.map((s) => { const startMin = t + 5; t = startMin + s.dwellMin; return { ...s, arriveMin: startMin, startMin, endMin: t, waitMin: 0, isAnchor: false, designated: false, fixedWindow: null, gap: null }; }); };
  const closing = mk('五點關的店', { hours: daily('09:00', '11:15') });
  const onway = { poi: closing, dwellMin: 60, priority: 'onway', optional: true, insertedBy: 'engine' };
  const mine = { poi: A, dwellMin: 60, priority: 'want', optional: false, insertedBy: null };
  const day = { date: THU, type: 'normal', window: { startMin: 540, endMin: 1350 }, windowRaw: { startMin: 540, endMin: 1440 }, regionZones: ['town'], designated: [], party: 1 };
  const sequence = seqOf([mine, onway]);   // 街區A 09:05–10:05、順路站 10:10–11:10（11:15 關）
  const args = { sequence, stop: breakfastStop(noodle, settings), day, home, legFn: flat, rules, settings, country: JP, kb };
  assert.equal(tryBreakfastFirst({ ...args, giveWay: 'fill' }).ok, false, '順路站會待過關門：只讓填站的設定排不進');
  const r = tryBreakfastFirst({ ...args, giveWay: 'onway' });
  assert.ok(r.ok);
  assert.deepEqual(r.displaced.map((s) => s.poi.id), [closing.id]);
  assert.deepEqual(r.trial.map((s) => s.poi.id), [noodle.id, A.id]);
  const picked = seqOf([mine, { ...onway, priority: 'want', optional: false, insertedBy: null }]);
  assert.equal(tryBreakfastFirst({ ...args, sequence: picked, giveWay: 'onway' }).ok, false, '同一站是他勾的就不讓');
});

test('對齊：第一站晚開、早上有空時，早餐往後挪到早餐段結束前吃完（晚點出門，不是吃完去門口等）；下一站不用等就不挪', () => {
  const late = mk('十一點開', { hours: daily('11:00', '12:30') });   // 12:30 就關：一定排在晚餐前；早上沒有別的站
  const trip = tripOf([{ date: THU, picks: want(late.id, dinner.id) }]);
  const pois = { [late.id]: late, [dinner.id]: dinner, [noodle.id]: noodle };
  const d = planTrip({ trip, pois, rules, settings, country: JP, kb, legFn: flat, restPool: [noodle] }).days[0];
  const [b, next] = d.plan.sequence;
  assert.equal(b.poi.id, noodle.id);
  assert.deepEqual([b.startMin, b.endMin], [9 * 60 + 40, 10 * 60], '09:40–10:00：早餐段（07:00–10:00）結束前吃完');
  assert.equal(next.startMin, 11 * 60, '下一站照樣 11:00 開門進去');
  assert.equal(next.waitMin, 11 * 60 - (10 * 60 + 5));
  // 三種對齊法
  const asap = [{ ...b, arriveMin: 545, startMin: 545, endMin: 565 }, { ...next, arriveMin: 570, waitMin: 90 }, ...d.plan.sequence.slice(2)];
  const ctx = { day: d.day, settings, country: JP };
  assert.equal(alignBreakfast(asap, { ...ctx, until: 'none' }), asap);
  assert.deepEqual([alignBreakfast(asap, ctx)[0].endMin, alignBreakfast(asap, ctx)[1].waitMin], [600, 55]);
  assert.deepEqual([alignBreakfast(asap, { ...ctx, until: 'window' })[0].endMin, alignBreakfast(asap, { ...ctx, until: 'window' })[1].waitMin], [655, 0], '放寬後的時窗到 11:00，但下一站 11:00 開、走 5 分：挪到 10:55 吃完剛好');
  assert.equal(alignBreakfast(asap, { day: d.day, settings, country: BASE_COUNTRY })[0].endMin, 655, '沒有早餐段就只看下一站等多久');
  const noWait = [asap[0], { ...asap[1], waitMin: 0 }];
  assert.equal(alignBreakfast(noWait, ctx), noWait, '下一站不用等：不挪');
  const notBreakfast = [{ ...asap[0], priority: 'filler' }, asap[1]];
  assert.equal(alignBreakfast(notBreakfast, ctx), notBreakfast, '第一站不是排成第一站的早餐：不動');
});

test('整趟一起分：一家店只當一天的早餐；只開某幾天的店排在它有開的日子（照日期先到先得會讓後面的日子沒早餐）；先比排得到的天數、再比備案與營業不固定用了幾天', () => {
  // 週四、週日兩天都要早餐：朝市只有週四開、麵店每天開，兩家都在住宿旁邊，麵店比較順路
  const market = eat('朝市', { hours: daily('07:00', '15:00', ['thu']) });
  const trip = tripOf([{ date: THU, picks: dayPicks }, { date: SUN, picks: dayPicks }]);
  const legFn = makeLeg({ 'home|朝市': 6, '朝市|街區A': 6 });
  const r = run(trip, [market, noodle], { legFn });
  assert.deepEqual(r.days.map((d) => d.plan.meals.breakfast), [market.id, noodle.id], '週四排朝市，把每天都開的麵店留給週日');
  // 同樣的題目照日期先到先得：週四拿走麵店，週日沒得排
  const opts = (date, list) => ({ date, options: list.map(([poi, detourMin, over = {}]) => ({ poi, detourMin, walkMin: detourMin, rank: 1, irregular: false, ev: { score: 100 }, ...over })) });
  const days = [opts(THU, [[noodle, 0], [market, 7]]), opts(SUN, [[noodle, 0]])];
  const by = (order) => Object.fromEntries([...assignBreakfasts({ days, order })].map(([date, o]) => [date, o.poi.id]));
  assert.deepEqual(by('date'), { [THU]: noodle.id });
  assert.deepEqual(by('scarce'), { [SUN]: noodle.id, [THU]: market.id });
  assert.deepEqual(by('best'), { [THU]: market.id, [SUN]: noodle.id });
  // 選擇少的先挑也會錯過的（仙台七天包 8/13、8/14、8/16 就是這個形狀）：三天各有一家營業固定的可分，貪婪卻讓選擇最多的那天用到營業不固定的
  const x = eat('甲'); const y = eat('乙'); const z = eat('丙'); const shaky = eat('不固定', { closeRisk: 'irregular' }); const spare = eat('備用', { researchRank: 'backup' });
  const three = [
    opts(THU, [[x, 0], [y, 1], [shaky, 0, { irregular: true }], [spare, 0, { rank: 2 }]]),
    opts(FRI, [[x, 0], [y, 1], [shaky, 0, { irregular: true }]]),
    opts(SUN, [[x, 0], [y, 1], [z, 5]]),
  ];
  const best = assignBreakfasts({ days: three });
  assert.deepEqual([THU, FRI, SUN].map((d) => best.get(d).poi.id).sort(), ['丙', '乙', '甲'], '三天都排到營業固定的');
  assert.equal(best.get(SUN).poi.id, '丙', '只有週日排得了丙');
  assert.ok([...assignBreakfasts({ days: three, order: 'scarce' }).values()].some((o) => o.irregular), '選擇少的先挑：有一天用到營業不固定的');
  // 被佔走的（別天他勾的早餐、記著要改天去的、換掉過的）不分；同一處的另一筆算同一家
  const sameAsX = eat('甲的另一筆', { samePlace: x.id });
  assert.deepEqual([...assignBreakfasts({ days: [opts(THU, [[x, 0], [y, 3]])], taken: [sameAsX] }).values()].map((o) => o.poi.id), ['乙']);
  assert.equal(assignBreakfasts({ days: [opts(THU, [[x, 0]])], taken: [x] }).size, 0);
  // 備案只有沒別家時才用；寧可用備案也不讓一天沒早餐
  const bk = eat('備案', { researchRank: 'backup' });
  const two = [opts(THU, [[x, 0], [bk, 0, { rank: 2 }]]), opts(FRI, [[x, 0]])];
  const m = assignBreakfasts({ days: two });
  assert.deepEqual([m.get(THU).poi.id, m.get(FRI).poi.id], ['備案', '甲']);
  assert.equal(assignBreakfasts().size, 0);
});

// 三天的旅程：前兩天要早餐（第三天起晚出門）；知識庫有三家早餐
const threeDays = tripOf([{ date: THU, picks: dayPicks }, { date: FRI, picks: want(C.id, lunch.id, dinner.id) }, { date: SAT, type: 'departure', departAirportMin: 18 * 60, picks: want(B.id) }]);
const pool3 = [noodle, stand, bakery];
const legs3 = makeLeg({ 'home|站內店': 6, 'home|麵包店': 8 });
const plan3 = (trip) => run(trip, pool3, { legFn: legs3 });
const AT = '2026-11-11T00:00:00.000Z';

test('吃飯店早餐（setBreakfast hotel）：那天不排早餐、不提示，其餘各站的先後與時刻就是沒有早餐的樣子；別天的早餐不變；原定那家別天引擎不拿，只在後面第一個合格的日子推薦一次', () => {
  const r0 = plan3(threeDays);
  const b = r0.days.map((d) => d.plan.meals.breakfast);
  assert.ok(b[0] && b[1] && b[2] && new Set(b).size === 3, `三天各排一家、不重複：${b.join('、')}`);
  const before = JSON.stringify(threeDays);
  const t1 = setBreakfast(threeDays, THU, 'hotel', b[0], AT);
  assert.equal(JSON.stringify(threeDays), before, '不改傳入的 trip');
  assert.deepEqual(t1.days[0].breakfast, { mode: 'hotel', poiId: b[0], at: AT });
  assert.deepEqual(t1.days[0].picks, threeDays.days[0].picks, '引擎排的早餐不在 picks 裡，不用拿');
  const r1 = plan3(t1);
  const none = plan3(hotelAll(threeDays));
  assert.deepEqual(r1.days[0].day.breakfast, { mode: 'hotel', poiId: b[0], movedTo: null });
  assert.deepEqual(r1.days.slice(1).map((d) => d.day.breakfast), [null, null], '照常排早餐的日子是 null');
  assert.equal(r1.days[0].plan.meals.breakfast, null);
  assert.deepEqual(hinted(r1.days[0].plan), [], '他說吃飯店：不提示');
  assert.deepEqual(times(r1.days[0].plan.sequence), times(none.days[0].plan.sequence), '其餘各站回到沒有早餐的時刻');
  assert.deepEqual(r1.days.slice(1).map((d) => times(d.plan.sequence)), r0.days.slice(1).map((d) => times(d.plan.sequence)), '別天一站都沒動');
  assert.ok(!r1.days.some((d) => ids(d.plan).includes(b[0])), '原定那家不被引擎拿去別天當早餐');
  // 推薦：只掛在後面第一個合格的日子
  const offers = r1.days.map((d) => d.plan.breakfastOffers);
  assert.deepEqual(offers[0], []);
  assert.equal(offers[1].length, 1);
  assert.deepEqual({ ...offers[1][0], detourMin: 0, shiftMin: 0 }, { poiId: b[0], fromDate: THU, mode: 'hotel', replaces: b[1], detourMin: 0, shiftMin: 0 });
  assert.ok(offers[1][0].shiftMin <= settings.breakfastOfferShiftMaxMin);
  assert.deepEqual(offers[2], [], 'hotel：不在別天重複出現');
  assert.deepEqual(rememberedBreakfasts(t1), [{ fromDate: THU, mode: 'hotel', poiId: b[0] }]);
  // 那天本來就沒排到早餐，他只是說在飯店吃：poiId null，沒有東西可推薦
  const t0 = setBreakfast(threeDays, THU, 'hotel', null, AT);
  assert.deepEqual(t0.days[0].breakfast, { mode: 'hotel', poiId: null, at: AT });
  assert.deepEqual(rememberedBreakfasts(t0), []);
  assert.ok(plan3(t0).days.every((d) => d.plan.breakfastOffers.length === 0));
  // 壞輸入不動
  assert.equal(setBreakfast(threeDays, THU, 'nope', b[0]), threeDays);
  assert.equal(setBreakfast(threeDays, '2026-01-01', 'hotel', b[0]), threeDays);
  assert.equal(breakfastChoiceOf({ breakfast: { mode: 'weird' } }), null);
  assert.equal(breakfastChoiceOf({ breakfast: 'hotel' }), null);
  assert.equal(breakfastChoiceOf({}), null);
});

test('改天去（setBreakfast later）：後面每個合格的日子都掛「或 X」；按了（takeBreakfastOffer）那天的早餐換成它、其餘各站先後不變、原本那天標已排走、不再推薦、被換掉的那家不會跑去別天；改回來（clearBreakfast）回到原樣', () => {
  const r0 = plan3(threeDays);
  const b = r0.days.map((d) => d.plan.meals.breakfast);
  const t1 = setBreakfast(threeDays, THU, 'later', b[0], AT);
  const r1 = plan3(t1);
  assert.deepEqual(r1.days.map((d) => d.plan.breakfastOffers.map((o) => `${o.poiId}:${o.mode}:${o.replaces}`)), [[], [`${b[0]}:later:${b[1]}`], [`${b[0]}:later:${b[2]}`]], '後面兩天都掛');
  assert.deepEqual(r1.days.slice(1).map((d) => d.plan.meals.breakfast), b.slice(1), '不自動動到別天');
  // 按第三天的「或 X」
  const before = JSON.stringify(t1);
  const t2 = takeBreakfastOffer(t1, SAT, b[0], r1.days[2].plan, AT);
  assert.equal(JSON.stringify(t1), before, '不改傳入的 trip');
  assert.deepEqual(t2.days[2].picks.at(-1), { poiId: b[0], priority: 'want', breakfast: true }, '引擎排的早餐被換掉：加一筆指定的早餐');
  assert.deepEqual(t2.days[2].swapped, [{ from: b[2], to: b[0], at: AT, breakfast: true }]);
  assert.equal(t2.days[0].breakfast.movedTo, SAT);
  assert.deepEqual(rememberedBreakfasts(t2), [], '排走了就不再記著');
  assert.deepEqual(blockedBreakfasts(t2), [b[2]]);
  const r2 = plan3(t2);
  assert.deepEqual(r2.days[0].day.breakfast, { mode: 'later', poiId: b[0], movedTo: SAT }, '畫面拿 movedTo 寫「X 改到 8/15」');
  const nb = breakfastOfPlan(r2.days[2].plan);
  assert.deepEqual([nb.poi.id, breakfastKind(nb), nb.breakfast, nb.insertedBy, nb.optional, r2.days[2].plan.sequence[0] === nb], [b[0], 'chosen', true, null, true, true]);
  assert.deepEqual(ids({ sequence: rest(r2.days[2].plan) }), ids({ sequence: rest(r1.days[2].plan) }), '那天其餘各站先後不變');
  assert.ok(r2.days.every((d) => d.plan.breakfastOffers.length === 0), '不再推薦');
  assert.deepEqual(r2.days.slice(0, 2).map((d) => times(d.plan.sequence)), r1.days.slice(0, 2).map((d) => times(d.plan.sequence)), '別天不變：被換掉的那家沒有跑去別天');
  assert.ok(!r2.days.some((d) => ids(d.plan).includes(b[2])), '換掉的那家引擎整趟不再主動拿');
  assert.equal(takeBreakfastOffer(t1, SAT, '沒有這個推薦', r1.days[2].plan), t1, '找不到那筆推薦就不動');
  // 改回來
  const back = clearBreakfast(t1, THU);
  assert.equal('breakfast' in back.days[0], false);
  assert.deepEqual(plan3(back).days.map((d) => times(d.plan.sequence)), r0.days.map((d) => times(d.plan.sequence)), '改回來＝原本的行程');
  assert.equal(clearBreakfast(threeDays, THU), threeDays, '沒有紀錄就回原 trip');
});

test('原定的早餐是他勾的站：setBreakfast 把那筆勾選拿掉記著（不進 removed），改回來放回原位；已經排到別天的不放回', () => {
  const picks = [...want(noodle.id), ...dayPicks];
  const trip = tripOf([{ date: THU, picks }, { date: FRI, picks: want(C.id, lunch.id) }]);
  const t1 = setBreakfast(trip, THU, 'later', noodle.id, AT);
  assert.deepEqual(t1.days[0].picks, dayPicks);
  assert.deepEqual(t1.days[0].breakfast, { mode: 'later', poiId: noodle.id, at: AT, pick: picks[0], pickIndex: 0 });
  assert.equal(t1.days[0].removed, undefined, '不是「不去了」');
  assert.deepEqual(clearBreakfast(t1, THU).days[0].picks, picks, '改回來：勾選放回原位');
  // 換一種：先改回來再記，不會把勾選弄丟
  const t2 = setBreakfast(t1, THU, 'hotel', noodle.id, AT);
  assert.deepEqual([t2.days[0].breakfast.mode, t2.days[0].breakfast.pick, t2.days[0].picks], ['hotel', picks[0], dayPicks]);
  // 排到別天之後再改回來：不放回（不然同一家店兩天都勾）
  const moved = { ...t1, days: t1.days.map((d) => (d.date === THU ? { ...d, breakfast: { ...d.breakfast, movedTo: FRI } } : d)) };
  assert.deepEqual(clearBreakfast(moved, THU).days[0].picks, dayPicks);
  // 同一家店不會被勾在兩天（11-12 審查）：記著沒去到的那家，在別天的早餐「換一家」清單選了它（不是按「或 X」）——
  // swapBreakfast 把原紀錄標成排到那天（movedTo），原來那天再按「改回來」就不放回勾選
  const friPlan = run(t1, [stand]).days[1].plan;
  const viaList = swapBreakfast(t1, FRI, noodle.id, friPlan, AT);
  assert.equal(viaList.days[0].breakfast.movedTo, FRI, '跟按「或 X」同一個處理');
  assert.ok(viaList.days[1].picks.some((p) => p.poiId === noodle.id && p.breakfast === true));
  const backAgain = clearBreakfast(viaList, THU);
  assert.deepEqual(backAgain.days[0].picks, dayPicks, '改回來：不放回（那家已經在 FRI）');
  assert.equal(backAgain.days.filter((d) => d.picks.some((p) => p.poiId === noodle.id)).length, 1, '只勾在一天');
  assert.deepEqual(rememberedBreakfasts(viaList), [], '排走了就不再等著推薦');
  // 別的路把它勾進別天（一般的換一家、手改旅程檔）：沒有 movedTo，改回來時看到別天已經勾了也不放回
  const elsewhere = { ...t1, days: t1.days.map((d) => (d.date === FRI ? { ...d, picks: [...d.picks, { poiId: noodle.id, priority: 'want' }] } : d)) };
  assert.deepEqual(clearBreakfast(elsewhere, THU).days[0].picks, dayPicks);
  assert.equal(clearBreakfast(elsewhere, THU).days[0].breakfast, undefined);
});

test('這家早餐後面有哪幾天排得進（breakfastLaterDays；11-17）：改天去與吃飯店早餐兩種紀錄都能問、還沒按也能問；最後一天後面沒有日子；要搭車的那家哪天都排不進；沒有哪一家可問回 null', () => {
  // 原話 #196「…不是不去了可能是改天去或是我吃飯店早餐」、#197「…後續的其中一天在不影響原定行程的前提下 可以再推薦我一次」：
  // 按了「改天去」之後後面一天都排不進時，畫面要講得出來；旅程最後一天的早餐卡不出「改天去」
  const ask = (trip, r, date, extra = {}) => breakfastLaterDays({ trip, days: r.days, date, pois: Object.fromEntries(WORLD.map((p) => [p.id, p])), restPool: pool3, legFn: legs3, rules, settings, country: JP, kb, ...extra });
  const r0 = plan3(threeDays);
  const b = r0.days.map((d) => d.plan.meals.breakfast);
  // 還沒按（那家現在是那天的早餐）：拿現在排好的每一天試
  assert.deepEqual(ask(threeDays, r0, THU), [FRI, SAT], '不給 poiId 就問那天現在的早餐');
  assert.deepEqual(ask(threeDays, r0, THU, { poiId: b[0] }), [FRI, SAT]);
  assert.deepEqual(ask(threeDays, r0, FRI), [SAT]);
  assert.deepEqual(ask(threeDays, r0, SAT), [], '旅程最後一天：後面沒有日子——早餐卡不出「改天去」');
  // 改天去：就是引擎掛「或 X」的那幾天
  const later = setBreakfast(threeDays, THU, 'later', b[0], AT);
  const rl = plan3(later);
  assert.deepEqual(ask(later, rl, THU), rl.days.filter((d) => d.plan.breakfastOffers.some((o) => o.poiId === b[0])).map((d) => d.date));
  assert.deepEqual(ask(later, rl, THU), [FRI, SAT]);
  // 吃飯店早餐：引擎只在第一個合格的日子推薦一次，但問「後面有哪幾天排得進」照樣每個排得進的日子都列
  const hotel = setBreakfast(threeDays, THU, 'hotel', b[0], AT);
  const rh = plan3(hotel);
  assert.deepEqual(rh.days.map((d) => d.plan.breakfastOffers.length), [0, 1, 0]);
  assert.deepEqual(ask(hotel, rh, THU), [FRI, SAT]);
  // 按了「或 X」排走之後：就是排到的那一天
  const taken = takeBreakfastOffer(later, SAT, b[0], rl.days[2].plan, AT);
  assert.deepEqual(ask(taken, plan3(taken), THU), [SAT]);
  // 紀錄上寫著已經排到別天（movedTo）、那天的序列裡卻沒有它（排成第一站會害別的站排不進、落在排不進清單）：照紀錄回那一天，不再當成還等著推薦
  const movedAway = { ...later, days: later.days.map((d) => (d.date === THU ? { ...d, breakfast: { ...d.breakfast, movedTo: FRI } } : d)) };
  assert.deepEqual(ask(movedAway, rl, THU), [FRI]);
  // breakfastFitDays 直接用：只回 fromDate 之後的日子（當天與前面的不算），帶換掉誰；最後一天之後沒有日子
  const prepared = r0.days.map((d) => ({ date: d.date, day: d.day, plan: d.plan, home, visited: [], pinned: false }));
  const fitArgs = { poi: pool3.find((p) => p.id === b[0]), days: prepared, legFn: legs3, rules, settings, country: JP, kb };
  assert.deepEqual(breakfastFitDays({ ...fitArgs, fromDate: FRI }).map((f) => [f.date, f.replaces]), [[SAT, b[2]]]);
  assert.deepEqual(breakfastFitDays({ ...fitArgs, fromDate: THU }).map((f) => f.date), [FRI, SAT]);
  assert.deepEqual(breakfastFitDays({ ...fitArgs, fromDate: SAT }), []);
  assert.deepEqual(breakfastFitDays({ ...fitArgs, fromDate: THU, country: BASE_COUNTRY }), [], '國家層沒有早餐段');
  // 那天本來就沒排到早餐、他只是說在飯店吃：沒有哪一家可問
  const none = setBreakfast(threeDays, THU, 'hotel', null, AT);
  assert.equal(ask(none, plan3(none), THU), null);
  assert.equal(ask(threeDays, r0, '2026-01-01'), null, '沒有那一天');
  // 國家層沒有早餐段：沒有早餐這回事
  const plain = run(threeDays, pool3, { country: BASE_COUNTRY, legFn: legs3 });
  assert.equal(breakfastLaterDays({ trip: threeDays, days: plain.days, date: THU, poiId: noodle.id, pois: {}, restPool: pool3, legFn: legs3, rules, settings, country: BASE_COUNTRY, kb }), null);
});

test('breakfastLaterDays 的兩支（11-17 審查的變異測試：這兩支拿掉沒有測試會紅）：那家已經被他勾進後面某一天（紀錄上沒有 movedTo）就回那一天；按了「改天去」照抄引擎掛推薦的日子——引擎驗過不掛的日子不列', () => {
  const poisOf = Object.fromEntries(WORLD.map((p) => [p.id, p]));
  // (一) 他把記著要改天去的那家自己勾進 FRI（一般的勾選，不是按「或 X」，所以 THU 的紀錄沒有 movedTo）：回 FRI。
  //      不看這一支的話，它已經不在推薦的名單裡（任何一天勾過的不推薦），答案會變成「後面沒有日子」
  const b = plan3(threeDays).days.map((d) => d.plan.meals.breakfast);
  const later = setBreakfast(threeDays, THU, 'later', b[0], AT);
  const picked = { ...later, days: later.days.map((d) => (d.date === FRI ? { ...d, picks: [...d.picks, { poiId: b[0], priority: 'want' }] } : d)) };
  const rp = plan3(picked);
  assert.ok(ids(rp.days[1].plan).includes(b[0]), `FRI 排進去了：${ids(rp.days[1].plan).join('、')}`);
  assert.equal(picked.days[0].breakfast.movedTo, undefined);
  assert.ok(rp.days.every((d) => d.plan.breakfastOffers.length === 0), '已經勾進別天：不再掛推薦');
  assert.deepEqual(breakfastLaterDays({ trip: picked, days: rp.days, date: THU, pois: poisOf, restPool: pool3, legFn: legs3, rules, settings, country: JP, kb }), [FRI]);
  // (二) 改天去：答案就是引擎掛了「或 X」的日子。SAT 的早餐是他勾的站自己落在早餐時段——引擎掛推薦之前會真的少勾那一站重排一次，其餘各站先後會變就不掛；
  //      這裡直接給排好的三天：FRI 掛了、SAT 沒掛（拿 SAT 現在的序列直接試是排得進的，但引擎驗過不掛）。答案只有 FRI
  const seqOf = (list) => { let t = 9 * 60; return list.map((s) => { const startMin = t + 5; t = startMin + s.dwellMin; return { poi: s.poi, dwellMin: s.dwellMin, priority: 'want', optional: false, insertedBy: null, isAnchor: false, designated: false, fixedWindow: null, gap: null, arriveMin: startMin, startMin, endMin: t, waitMin: 0 }; }); };
  const dayOf = (date) => ({ date, type: 'normal', window: { startMin: 540, endMin: 1350 }, windowRaw: { startMin: 540, endMin: 1440 }, regionZones: ['town'], designated: [], party: 1, breakfast: null });
  const planOf = (list, offers = []) => ({ sequence: seqOf(list), dropped: [], complete: true, breakfastOffers: offers, meals: {} });
  const trip = tripOf([{ date: THU, picks: dayPicks, breakfast: { mode: 'later', poiId: noodle.id, at: AT } }, { date: FRI, picks: want(A.id, B.id) }, { date: SAT, picks: want(stand.id, A.id, B.id) }]);
  const days = [
    { date: THU, day: { ...dayOf(THU), breakfast: { mode: 'later', poiId: noodle.id, movedTo: null } }, plan: planOf([{ poi: A, dwellMin: 60 }]) },
    { date: FRI, day: dayOf(FRI), plan: planOf([{ poi: bakery, dwellMin: 20 }, { poi: A, dwellMin: 60 }, { poi: B, dwellMin: 60 }], [{ poiId: noodle.id, fromDate: THU, mode: 'later', replaces: bakery.id, detourMin: 0, shiftMin: 0 }]) },
    { date: SAT, day: dayOf(SAT), plan: planOf([{ poi: stand, dwellMin: 20 }, { poi: A, dwellMin: 60 }, { poi: B, dwellMin: 60 }]) },
  ];
  const args = { trip, days, pois: poisOf, restPool: pool3, legFn: flat, rules, settings, country: JP, kb };
  assert.deepEqual(breakfastFitDays({ poi: noodle, fromDate: THU, days: days.slice(1).map((d) => ({ ...d, home, visited: [], pinned: false })), legFn: flat, rules, settings, country: JP, kb }).map((f) => f.date), [FRI, SAT], '對照：拿現在的序列直接試，兩天都排得進');
  assert.deepEqual(breakfastLaterDays({ ...args, date: THU }), [FRI], '改天去：照抄引擎掛的日子，SAT 不列');
  // 同一份排法、紀錄換成「吃飯店早餐」：引擎只掛第一個合格的日子，所以後面的日子拿現在的行程再試——SAT 會列（這一支的差別）
  const hotelTrip = { ...trip, days: trip.days.map((d) => (d.date === THU ? { ...d, breakfast: { ...d.breakfast, mode: 'hotel' } } : d)) };
  const hotelDays = days.map((d) => (d.date === FRI ? { ...d, plan: { ...d.plan, breakfastOffers: d.plan.breakfastOffers.map((o) => ({ ...o, mode: 'hotel' })) } } : d));
  assert.deepEqual(breakfastLaterDays({ ...args, trip: hotelTrip, days: hotelDays, date: THU }), [FRI, SAT]);
});

test('後面一天都排不進的那一家（要搭車才到得了：先吃再上車，哪天都當不了第一站）：還沒按就問得出來、按了「改天去」之後引擎沒有一天掛推薦，breakfastLaterDays 都是空的', () => {
  // 試走版 8/15 的松島星鰻丼就是這種：他勾的站自己落在早餐時段，按了「改天去」之後後面沒有任何一句話（11-12 審查）
  const far = eat('外地丼', { dwellMin: 40 });
  const rideLegs = makeLeg({}, { 'home|外地丼': 20, '外地丼|街區A': 20, '外地丼|街區C': 20, '外地丼|街區B': 20, '外地丼|午餐店': 20, '外地丼|晚餐店': 20 });
  const trip = tripOf([{ date: THU, picks: [...want(far.id), ...dayPicks] }, { date: FRI, picks: want(C.id, lunch.id, dinner.id) }, { date: SAT, type: 'departure', departAirportMin: 18 * 60, picks: want(B.id) }]);
  const pois = Object.fromEntries([...WORLD, far].map((p) => [p.id, p]));
  const plan = (t) => planTrip({ trip: t, pois, rules, settings, country: JP, kb, legFn: rideLegs, restPool: [stand, bakery] });
  const ask = (t, r) => breakfastLaterDays({ trip: t, days: r.days, date: THU, pois, restPool: [stand, bakery], legFn: rideLegs, rules, settings, country: JP, kb });
  const r0 = plan(trip);
  assert.equal(r0.days[0].plan.meals.breakfast, far.id, '他勾的站自己落在早餐時段，就是那天的早餐');
  assert.deepEqual(ask(trip, r0), [], '還沒按：後面兩天它都當不了第一站');
  const t1 = setBreakfast(trip, THU, 'later', far.id, AT);
  const r1 = plan(t1);
  assert.ok(r1.days.every((d) => d.plan.breakfastOffers.length === 0), '引擎後面沒有一天掛得出「或 外地丼」');
  assert.deepEqual(ask(t1, r1), [], '畫面拿這個空陣列在復原列多講半句');
  // 同一個世界裡走得到的那家照樣問得到日子（對照）
  assert.deepEqual(breakfastLaterDays({ trip, days: r0.days, date: FRI, pois, restPool: [stand, bakery], legFn: rideLegs, rules, settings, country: JP, kb }), [SAT]);
});

test('早餐換一家（swapBreakfast）：引擎排的換了就變成他指定的（picks 多一筆 breakfast: true）、照樣排在第一站、其餘各站先後不變、別天的早餐不跟著變；他指定的再換一次是換那一筆', () => {
  const r0 = plan3(threeDays);
  const b = r0.days.map((d) => d.plan.meals.breakfast);
  const other = eat('第四家'); const pool4 = [...pool3, other];
  const plan4 = (trip) => run(trip, pool4, { legFn: makeLeg({ 'home|站內店': 6, 'home|麵包店': 8, 'home|第四家': 9 }) });
  const p0 = plan4(threeDays);
  assert.deepEqual(p0.days.map((d) => d.plan.meals.breakfast), b, '多一家比較遠的，引擎挑的不變');
  const t1 = swapBreakfast(threeDays, THU, other.id, p0.days[0].plan, AT);
  assert.deepEqual(t1.days[0].picks.at(-1), { poiId: other.id, priority: 'want', breakfast: true });
  assert.deepEqual(t1.days[0].swapped, [{ from: b[0], to: other.id, at: AT, breakfast: true }]);
  const p1 = plan4(t1);
  const nb = breakfastOfPlan(p1.days[0].plan);
  assert.deepEqual([nb.poi.id, breakfastKind(nb), p1.days[0].plan.sequence[0] === nb], [other.id, 'chosen', true]);
  assert.deepEqual(ids({ sequence: rest(p1.days[0].plan) }), ids({ sequence: rest(p0.days[0].plan) }));
  assert.deepEqual(p1.days.slice(1).map((d) => d.plan.meals.breakfast), b.slice(1), '別天的早餐沒有跟著變');
  // 再換一次：換的是那一筆指定的早餐，不是再加一筆
  const t2 = swapBreakfast(t1, THU, b[0], p1.days[0].plan, AT);
  assert.deepEqual(t2.days[0].picks.filter((p) => p.breakfast), [{ poiId: b[0], priority: 'want', breakfast: true }]);
  assert.equal(t2.days[0].picks.length, t1.days[0].picks.length);
  assert.deepEqual(t2.days[0].swapped.map((x) => `${x.from}>${x.to}`), [`${b[0]}>${other.id}`, `${other.id}>${b[0]}`]);
  assert.equal(breakfastOfPlan(plan4(t2).days[0].plan).poi.id, b[0], '他自己指定的不受「換掉過的引擎不再拿」影響');
  assert.equal(swapBreakfast(threeDays, THU, '', p0.days[0].plan), threeDays);
  assert.equal(swapBreakfast(threeDays, '2026-01-01', other.id, p0.days[0].plan), threeDays);
  // 他指定的早餐不出二選一（早餐卡有自己的換一家）
  assert.equal(isChoiceStop({ poi: mk('喫茶', { category: 'cafe' }), priority: 'want', breakfast: true }), false);
  assert.equal(isChoiceStop({ poi: mk('喫茶', { category: 'cafe' }), priority: 'want' }), true);
});

test('他指定的早餐排成第一站會害別的站排不進：落到那天的排不進清單（附理由），引擎另挑一家；這天不要早餐（晚出門日）時指定的那筆當一般的站排', () => {
  const tight = mk('十點半關', { hours: daily('09:00', '10:30') });
  const long = eat('要吃很久', { dwellMin: 45 });
  const quick = eat('很快', { dwellMin: 10 });
  const trip = tripOf([{ date: THU, picks: [{ poiId: tight.id, priority: 'must' }, ...want(lunch.id), { poiId: long.id, priority: 'want', breakfast: true }] }]);
  const pois = Object.fromEntries([tight, lunch, long, quick].map((p) => [p.id, p]));
  const d = planTrip({ trip, pois, rules, settings, country: JP, kb, legFn: flat, restPool: [long, quick] }).days[0];
  assert.equal(d.plan.meals.breakfast, quick.id, `指定的那家排不進，引擎另挑停留短的：${ids(d.plan).join('→')}`);
  const dropped = d.plan.dropped.find((x) => x.poi.id === long.id);
  assert.ok(dropped, '指定的那家在排不進清單');
  assert.match(dropped.reason, /排成早餐（第一站）的話.*十點半關/);
  assert.ok(ids(d.plan).includes(tight.id));
  // 晚出門日：不要早餐，指定的那筆照一般的站排（不會消失）
  const lateTrip = tripOf([{ date: THU, picks: dayPicks }, { date: FRI, picks: dayPicks }, { date: SAT, picks: [...want(C.id), { poiId: noodle.id, priority: 'want', breakfast: true }] }]);
  const third = run(lateTrip, [noodle, stand, bakery]).days[2];
  assert.ok(ids(third.plan).includes(noodle.id) || third.plan.dropped.some((x) => x.poi.id === noodle.id), '不會憑空消失');
  assert.equal(third.plan.meals.breakfast, null);
});

test('排不成第一站的原因各有各的代號（當天沒開、出門時還沒開、沒有營業時間、要搭車、太遠、它自己待不完）；他指定的那家排不進時，排不進清單上的那一句照原因寫', () => {
  const trip = tripOf([{ date: THU, picks: dayPicks }]);
  const base = run(hotelAll(trip), []).days[0];
  const args = { sequence: base.plan.sequence, complete: base.plan.complete, day: { ...base.day, breakfast: null }, home, rules, settings, country: JP, kb };
  const why = (poi, over = {}) => { const r = tryBreakfastFirst({ ...args, legFn: flat, stop: breakfastStop(poi, settings), ...over }); return r.ok ? 'ok' : r.why; };
  const closedToday = eat('今天休', { closedDates: [THU] });
  const closesSoon = eat('很快就關', { hours: daily('07:00', '09:15') });
  assert.equal(why(noodle), 'ok');
  assert.equal(why(closedToday), 'closed-today');
  assert.equal(why(eat('週日才開', { hours: daily('07:00', '22:00', ['sun']) })), 'closed-today');
  assert.equal(why(eat('九點半才開', { hours: daily('09:30', '22:00') })), 'closed', '等它開門後面的站都要晚');
  assert.equal(why(eat('時段不明', { hours: null })), 'hours-unknown');
  assert.equal(why(eat('要搭車'), { legFn: makeLeg({}, { 'home|要搭車': 20 }) }), 'ride');
  const farLegs = makeLeg({ 'home|太遠': 20, '太遠|街區A': 20, '太遠|街區B': 20 });
  assert.equal(why(eat('太遠'), { legFn: farLegs, near: { maxWalkMin: settings.breakfastWalkMaxMin, maxDetourMin: settings.onTheWayDetourMin } }), 'far');
  assert.notEqual(why(eat('太遠'), { legFn: farLegs }), 'far', '沒給 near（他自己指定的、推薦的）就不看遠近');
  assert.equal(why(closesSoon), 'self');
  // 他指定的那家：排不進清單上的那一句
  const reasonOf = (poi) => {
    const t = tripOf([{ date: THU, picks: [...dayPicks, { poiId: poi.id, priority: 'want', breakfast: true }] }]);
    const d = planTrip({ trip: t, pois: Object.fromEntries([...WORLD, poi].map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: flat, restPool: [poi, noodle] }).days[0];
    assert.equal(d.plan.meals.breakfast, noodle.id, `${poi.id}：引擎另挑一家`);
    assert.ok(!ids(d.plan).includes(poi.id), `${poi.id}：不會改排成一般的站`);
    return d.plan.dropped.find((x) => x.poi.id === poi.id)?.reason;
  };
  assert.equal(reasonOf(closedToday), '今天沒開');
  assert.equal(reasonOf(eat('九點半才開', { hours: daily('09:30', '22:00') })), '出門的時候它還沒開，等它開門後面的站都要往後挪');
  assert.equal(reasonOf(eat('時段不明', { hours: null })), '沒有營業時間資料，不排成早餐');
  assert.match(reasonOf(closesSoon), /^排成早餐（第一站）排不進：.*很快就關/);
});

test('有人照一般的站對引擎排的早餐按了「不去了」（removed 記了 priority breakfast）：那天引擎不再排早餐、那家整趟不拿；不當成拒絕恢復站', () => {
  const trip = tripOf([{ date: THU, picks: dayPicks, removed: [{ poiId: noodle.id, insertedBy: 'engine', priority: 'breakfast', at: AT }] }, { date: FRI, picks: dayPicks }]);
  const r = run(trip, [noodle, stand]);
  assert.equal(r.days[0].plan.meals.breakfast, null, '拒絕過引擎排的早餐：那天不再排');
  assert.equal(hinted(r.days[0].plan).length, 1);
  assert.equal(r.days[1].plan.meals.breakfast, stand.id, '按過不去了的那家別天也不拿');
});

test('推薦遇到「那天的早餐是他勾的站」：真的少勾那一站重排一次才算——其餘各站先後會變、或有站因此排不進的不掛；必去／指定／主行程／固定時段的早餐不掛', () => {
  const seqOf = (list) => { let t = 9 * 60; return list.map((s) => { const startMin = t + 5; t = startMin + s.dwellMin; return { poi: s.poi, dwellMin: s.dwellMin, priority: s.priority ?? 'want', optional: false, insertedBy: null, isAnchor: false, designated: false, fixedWindow: null, gap: null, arriveMin: startMin, startMin, endMin: t, waitMin: 0, ...s.over }; }); };
  const day = { date: FRI, type: 'normal', window: { startMin: 540, endMin: 1350 }, windowRaw: { startMin: 540, endMin: 1440 }, regionZones: ['town'], designated: [], party: 1, breakfast: null };
  const mineBf = { poi: stand, dwellMin: 20 };
  const sequence = seqOf([mineBf, { poi: A, dwellMin: 60 }, { poi: B, dwellMin: 60 }]);
  const plan = { sequence, dropped: [], complete: true };
  const entries = [{ fromDate: THU, mode: 'later', poi: noodle }];
  const offersWith = (extra) => breakfastOffers({ entries, days: [{ date: FRI, day, plan, home, visited: [], ...extra }], legFn: flat, rules, settings, country: JP, kb }).get(FRI) ?? [];
  const without = (order) => () => ({ sequence: seqOf(order.map((poi) => ({ poi, dwellMin: 60 }))), dropped: [], complete: true });
  assert.equal(offersWith({ replanWithout: without([A, B]) }).length, 1, '少勾那一站重排，其餘先後不變：掛');
  assert.equal(offersWith({ replanWithout: without([A, B]) })[0].replaces, stand.id);
  assert.deepEqual(offersWith({ replanWithout: without([B, A]) }), [], '重排之後先後變了：不掛');
  assert.deepEqual(offersWith({ replanWithout: () => ({ sequence: seqOf([{ poi: A, dwellMin: 60 }]), dropped: [{ poi: B }], complete: true }) }), [], '重排之後有站排不進：不掛');
  assert.equal(offersWith({}).length, 1, '沒給重排的函式（單獨呼叫）：拿現在的序列估');
  for (const over of [{ priority: 'must' }, { designated: true }, { isAnchor: true }, { fixedWindow: { startMin: 545 } }]) {
    const locked = { ...plan, sequence: [{ ...sequence[0], ...over }, ...sequence.slice(1)] };
    assert.deepEqual(breakfastOffers({ entries, days: [{ date: FRI, day, plan: locked, home, visited: [] }], legFn: flat, rules, settings, country: JP, kb }).get(FRI) ?? [], [], JSON.stringify(over));
  }
  // 去過的（按過「我進去了」）不再推薦；前面的日子不掛；晚太多的不掛；沒有早餐段不掛
  assert.deepEqual(breakfastOffers({ entries, days: [{ date: FRI, day, plan, home, visited: [noodle.id] }], legFn: flat, rules, settings, country: JP, kb }).size, 0);
  assert.deepEqual(breakfastOffers({ entries: [{ fromDate: SAT, mode: 'later', poi: noodle }], days: [{ date: FRI, day, plan, home }], legFn: flat, rules, settings, country: JP, kb }).size, 0);
  assert.deepEqual(breakfastOffers({ entries: [{ fromDate: THU, mode: 'later', poi: eat('吃很久', { dwellMin: 60 }) }], days: [{ date: FRI, day, plan, home }], legFn: flat, rules, settings, country: JP, kb }).size, 0, '其餘各站會晚 40 分，超過 10');
  assert.deepEqual(breakfastOffers({ entries, days: [{ date: FRI, day, plan, home }], legFn: flat, rules, settings, country: BASE_COUNTRY, kb }).size, 0);
});

test('早餐的換一家清單（breakfastSwapCandidates）：每一家都真的排成第一站試過；形狀跟一般的換一家候選一樣；不列不該推薦的、這天已經有的、exclude 給的與同一處的另一筆', () => {
  const r0 = plan3(threeDays);
  const d = r0.days[0];
  const gated = eat('未解鎖', { unlockWhen: '下次再說' });
  const twin = eat('站內店的另一筆', { samePlace: stand.id });
  const far = eat('太遠');
  const pool = [...pool3, gated, twin, far, eat('不固定', { closeRisk: 'irregular' }), eat('備案', { researchRank: 'backup' })];
  const legFn = makeLeg({ 'home|站內店': 6, 'home|麵包店': 8, 'home|太遠': 25, '太遠|街區A': 25 });
  const list = (exclude = []) => breakfastSwapCandidates({ plan: d.plan, day: d.day, home, pool, legFn, rules, settings, country: JP, kb, exclude });
  const all = list();
  const cur = d.plan.meals.breakfast;
  assert.ok(!all.some((c) => c.poi.id === cur), '現在這一家不列');
  assert.ok(!all.some((c) => [gated.id, far.id].includes(c.poi.id)), '還沒解鎖的、太遠的不列');
  assert.deepEqual(Object.keys(all[0]).sort(), ['detourMin', 'meal', 'mealNote', 'open', 'poi', 'shiftMin', 'walkMin']);
  assert.deepEqual([all[0].meal, all[0].open, typeof all[0].mealNote], ['breakfast', true, 'string']);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].detourMin <= all[i].detourMin, '照多繞的分鐘排');
  assert.ok(all.findIndex((c) => c.poi.id === '備案') > all.findIndex((c) => c.poi.id === '不固定'), '一樣多繞：備案排最後');
  // exclude：畫面傳「任何一天勾過的＋任何一天序列裡的」，同一處的另一筆也跟著不列
  const others = r0.days.slice(1).map((x) => x.plan.meals.breakfast);
  const narrowed = list([...others, stand.id]);
  assert.ok(!narrowed.some((c) => others.includes(c.poi.id) || c.poi.id === stand.id || c.poi.id === twin.id));
  assert.deepEqual(breakfastSwapCandidates({ plan: d.plan, day: d.day, home, pool, legFn, rules, settings, country: BASE_COUNTRY, kb }), [], '沒有早餐段就沒有清單');
});

test('整趟一起排時的其他保證：能當早餐的店不被當成填站或恢復站插進別的時段；引擎排的早餐不佔每天 8 站與引擎插站的名額；只試排某幾天（onlyDates）不出錯', () => {
  // 等開門的空檔旁邊只有一家能當早餐的店：有早餐段時不拿它當填站
  const early = mk('早的', { hours: daily('09:00', '11:00') });
  const late = mk('晚開', { hours: daily('13:00', '23:00') });
  const cafe = eat('早餐咖啡', { category: 'cafe', cafeLike: true, dwellMin: 40 });
  const trip = tripOf([{ date: THU, designated: [early.id, late.id], picks: [{ poiId: early.id, priority: 'must' }, { poiId: late.id, priority: 'must' }], breakfast: { mode: 'hotel', poiId: null } }]);
  const pois = { [early.id]: early, [late.id]: late, [cafe.id]: cafe };
  const planWith = (country) => planTrip({ trip, pois, rules, settings, country, kb, legFn: flat, restPool: [cafe] }).days[0].plan;
  assert.ok(ids(planWith(BASE_COUNTRY)).includes(cafe.id), '沒有早餐段：照舊可以當填站');
  assert.ok(!ids(planWith(JP)).includes(cafe.id), '有早餐段：留給早餐，不當填站');
  // 只保留住宿旁邊的：離住宿走 20 分（超過 breakfastWalkMaxMin）的當不了引擎排的早餐，照舊可以當填站
  const farFromHome = planTrip({ trip, pois, rules, settings, country: JP, kb, legFn: makeLeg({ 'home|早餐咖啡': 20 }), restPool: [cafe] }).days[0].plan;
  assert.ok(ids(farFromHome).includes(cafe.id), `離住宿遠的不保留：${ids(farFromHome).join('→')}`);
  assert.equal(farFromHome.sequence.find((s) => s.poi.id === cafe.id).priority, 'filler');
  // 他勾了 8 站，早餐是第 9 個也排得進（不佔名額）
  const eight = Array.from({ length: 8 }, (_, i) => mk(`站${i}`, { dwellMin: 30 }));
  const full = tripOf([{ date: THU, picks: want(...eight.map((p) => p.id)) }]);
  const fd = planTrip({ trip: full, pois: Object.fromEntries([...eight, noodle].map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: flat, restPool: [noodle] }).days[0];
  assert.equal(fd.plan.sequence.length, 9);
  assert.equal(fd.plan.meals.breakfast, noodle.id);
  assert.deepEqual(fd.plan.dropped, []);
  // onlyDates
  const some = planTrip({ trip: threeDays, pois: Object.fromEntries(WORLD.map((p) => [p.id, p])), rules, settings, country: JP, kb, legFn: legs3, restPool: pool3, options: { onlyDates: [FRI] } });
  assert.deepEqual(some.days.map((d) => Boolean(d.plan)), [false, true, false]);
  assert.ok(some.days[1].plan.meals.breakfast);
});

// ── 11-12 審查後補的（修正段）──

test('推薦不被引擎填的站擋住（11-12）：第一站很晚才開、早上被引擎填著的日子，早餐排進來填站往後挪就好——它不算在「其餘各站最多晚 10 分」裡；他勾的站照算', () => {
  const late = mk('晚開的展館', { hours: daily('11:00', '23:00') });
  // 三家可以拿來填空檔的喫茶（不能當正餐、不是順路站會拿的那種）：THU 有兩段等開門的空檔（午餐前、晚餐前；一天最多填兩家），FRI 早上的空檔用剩下那一家
  const tea1 = mk('喫茶甲', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, meals: {} });
  const tea2 = mk('喫茶乙', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, meals: {} });
  const tea3 = mk('喫茶丙', { category: 'cafe', walkFactor: 0, recovery: true, cafeLike: true, meals: {} });
  const pois = Object.fromEntries([A, B, lunch, dinner, late, noodle, tea1, tea2, tea3].map((p) => [p.id, p]));
  const plan = (t) => planTrip({ trip: t, pois, rules, settings, country: JP, kb, legFn: flat, restPool: [noodle, tea1, tea2, tea3] });
  // FRI 只勾一站、11:00 才開，而且他拒絕過引擎排的早餐：那天沒有早餐站；太晚出門觸發填站，早上有一個引擎填的站
  const friOf = (picks) => ({ date: FRI, picks, removed: [{ poiId: 'x', insertedBy: 'engine', priority: 'breakfast' }] });
  const trip = tripOf([{ date: THU, picks: dayPicks }, friOf(want(late.id))]);
  const r0 = plan(trip);
  assert.equal(r0.days[0].plan.meals.breakfast, noodle.id);
  const fri0 = r0.days[1].plan;
  assert.deepEqual(fri0.sequence.map((s) => [s.insertedBy, s.priority]), [['engine', 'filler'], [null, 'want']], `太晚出門也觸發填站：早上的空檔填了一家（${ids(fri0).join('→')}）`);
  const filler = fri0.sequence[0].poi;
  assert.equal(fri0.meals.breakfast, null);
  // THU 的早餐改天去 → 掛在 FRI：排成第一站之後填站往後挪 25 分（超過 10），他勾的展館一分不晚 → 照掛，shiftMin 0
  const later = setBreakfast(trip, THU, 'later', noodle.id, AT);
  const r1 = plan(later);
  assert.deepEqual(r1.days[1].plan.breakfastOffers, [{ poiId: noodle.id, fromDate: THU, mode: 'later', replaces: null, detourMin: 5, shiftMin: 0 }]);
  // 按了：早餐在第一站、填站還在（往後挪）、展館照舊 11:00
  const r2 = plan(takeBreakfastOffer(later, FRI, noodle.id, r1.days[1].plan, AT));
  assert.deepEqual(ids(r2.days[1].plan), [noodle.id, filler.id, late.id]);
  assert.equal(r2.days[1].plan.sequence.at(-1).startMin, 11 * 60);
  assert.ok(r2.days[1].plan.sequence[1].startMin - fri0.sequence[0].startMin > 10, '填站晚了不只 10 分');
  // 對照：早上那一站是他自己勾的（不是引擎填的）就照算——晚 25 分超過 10，不掛
  const mine = tripOf([{ date: THU, picks: dayPicks }, friOf(want(filler.id, late.id))]);
  const r3 = plan(setBreakfast(mine, THU, 'later', noodle.id, AT));
  assert.deepEqual(ids(r3.days[1].plan).slice(0, 1), [filler.id]);
  assert.deepEqual(r3.days[1].plan.breakfastOffers, []);
});

test('沿用上一版引擎挑的早餐（11-12 畫面審查；assignBreakfasts 的 keep、旅程檔 days[].engineBreakfast）：那一家還排得進、沒被佔走就不換，排不進或被佔走的那天才重挑；沒記的時候跟以前一樣整趟一起分', () => {
  // 純函式：三天三家，整趟最好的分法是 THU 甲、FRI 乙、SUN 丙（丙只有週日排得了）
  const opts = (date, list) => ({ date, options: list.map(([poi, detourMin, over = {}]) => ({ poi, detourMin, walkMin: detourMin, rank: 1, irregular: false, ev: { score: 100 }, ...over })) });
  const x = eat('甲'); const y = eat('乙'); const z = eat('丙'); const shaky = eat('不固定', { closeRisk: 'irregular' });
  const three = [opts(THU, [[x, 0], [y, 1], [shaky, 0, { irregular: true }]]), opts(FRI, [[x, 0], [y, 1], [shaky, 0, { irregular: true }]]), opts(SUN, [[x, 0], [y, 1], [z, 5]])];
  const by = (args) => Object.fromEntries([THU, FRI, SUN].map((d) => [d, assignBreakfasts({ days: three, ...args }).get(d)?.poi.id ?? null]));
  const fresh = by({});
  assert.deepEqual(fresh, { [THU]: '甲', [FRI]: '乙', [SUN]: '丙' });
  assert.deepEqual(by({ keep: new Map([[THU, '乙'], [FRI, '甲'], [SUN, '丙']]) }), { [THU]: '乙', [FRI]: '甲', [SUN]: '丙' }, '上一版是 THU 乙、FRI 甲：都還排得進，照舊（不換成整趟最好的那一種）');
  assert.deepEqual(by({ keep: { [THU]: '乙' } }), { [THU]: '乙', [FRI]: '甲', [SUN]: '丙' }, '物件也收；只記了一天：那天沿用，其餘的日子照剩下的店分');
  assert.deepEqual(by({ keep: new Map([[THU, '丙']]) }), fresh, '記著的那一家不在那天排得進的名單裡：當作沒記');
  assert.deepEqual(by({ keep: new Map([[THU, '甲'], [FRI, '甲']]) }), { [THU]: '甲', [FRI]: '乙', [SUN]: '丙' }, '兩天記著同一家：日期在前的沿用，後面那天重挑');
  assert.deepEqual(by({ keep: new Map([[FRI, '甲']]), taken: [eat('甲的另一筆', { samePlace: x.id })] }), { [THU]: '乙', [FRI]: '不固定', [SUN]: '丙' }, '記著的那一家被佔走了（同一處的另一筆也算）：不沿用');
  assert.deepEqual(by({ keep: new Map([[THU, '乙'], [FRI, '甲']]), order: 'date' }), { [THU]: '乙', [FRI]: '甲', [SUN]: '丙' }, '另外兩種分法也先沿用');
  assert.deepEqual(by({ keep: new Map() }), fresh);
  assert.deepEqual(by({ keep: new Map([[THU, 7], [FRI, '']]) }), fresh, '寫壞的當沒記');
  // 旅程檔：keepBreakfasts 把每天引擎排的早餐記回來；breakfastKeepOf 讀出來
  const r0 = plan3(threeDays);
  const b = r0.days.map((d) => d.plan.meals.breakfast);
  const t0 = keepBreakfasts(threeDays, r0.days);
  assert.notEqual(t0, threeDays);
  assert.equal(threeDays.days.some((d) => 'engineBreakfast' in d), false, '不改傳入的 trip');
  assert.deepEqual(t0.days.map((d) => d.engineBreakfast), b);
  assert.deepEqual([...breakfastKeepOf(t0)], [[THU, b[0]], [FRI, b[1]], [SAT, b[2]]]);
  assert.equal(keepBreakfasts(t0, r0.days), t0, '沒有東西要改：回同一個物件');
  assert.deepEqual(plan3(t0).days.map((d) => times(d.plan.sequence)), r0.days.map((d) => times(d.plan.sequence)), '帶著自己那一份重排，整趟一模一樣');
  assert.deepEqual([...breakfastKeepOf({ days: [{ date: THU, engineBreakfast: 5 }, { date: FRI, engineBreakfast: '' }, { date: SAT }] })], []);
  // 引擎照記著的排，不照它自己整趟最好的那一種：把前兩天對調記著
  const crossed = { ...threeDays, days: threeDays.days.map((d, i) => ({ ...d, engineBreakfast: [b[1], b[0], b[2]][i] })) };
  const r1 = plan3(crossed);
  assert.deepEqual(r1.days.map((d) => d.plan.meals.breakfast), [b[1], b[0], b[2]]);
  assert.deepEqual(r1.days.map((d) => ids({ sequence: rest(d.plan) })), r0.days.map((d) => ids({ sequence: rest(d.plan) })), '其餘各站先後不變');
  assert.equal(keepBreakfasts(crossed, r1.days), crossed);
  // 他說那天吃飯店早餐：那天沒有引擎排的早餐，備忘拿掉；別天沿用、照舊
  const hotel = setBreakfast(crossed, THU, 'hotel', b[1], AT);
  const r2 = plan3(hotel);
  assert.deepEqual(r2.days.map((d) => d.plan.meals.breakfast), [null, b[0], b[2]]);
  const t2 = keepBreakfasts(hotel, r2.days);
  assert.equal('engineBreakfast' in t2.days[0], false);
  assert.deepEqual(t2.days.slice(1).map((d) => d.engineBreakfast), [b[0], b[2]]);
  // 改回來：別天都沿用著，那天從剩下的店裡挑，拿回原本那一家
  assert.deepEqual(plan3(clearBreakfast(t2, THU)).days.map((d) => d.plan.meals.breakfast), [b[1], b[0], b[2]]);
  // 沒排的日子（plan 是 null）記著的不動
  assert.equal(keepBreakfasts(crossed, [{ date: THU, plan: null }, { date: FRI, plan: null }]), crossed);
  // 只試排一天（options.onlyDates）：別天記著的那一家算被佔走，這一天不會把它拿走
  const all3 = Object.fromEntries([...pool3, ...WORLD].map((p) => [p.id, p]));
  const only = (trip) => planTrip({ trip, pois: all3, rules, settings, country: JP, kb, legFn: legs3, restPool: pool3, options: { onlyDates: [THU] } }).days[0].plan.meals.breakfast;
  const alone = only(threeDays);
  assert.ok(alone, '只排 THU：它自己挑一家');
  const held = { ...threeDays, days: threeDays.days.map((d) => (d.date === FRI ? { ...d, engineBreakfast: alone } : d)) };
  assert.notEqual(only(held), alone, 'FRI 記著那一家：只排 THU 時不拿它');
  assert.ok(only(held));
});
