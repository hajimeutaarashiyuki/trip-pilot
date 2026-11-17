// 餐段與早餐的畫面邏輯（ui/meals.js；原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧…這可以當晚餐嗎 如果可以那也應該在簡介裡提及」、
// #196「早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」、#197 沒去到的後面再推薦一次）：純函式——
// 這一站是不是早餐卡、換一家清單最上面那一句與每家的說明、早餐卡上的「或 X」、日期下面那行小字。小世界見 _world.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealOf, breakfastCardOf, mealNoteText, breakfastExclude, swapListOf, otherDaysStops, SWAP_LIST_MAX, offersOn, looseOffers, breakfastOffText, pickedBreakfast, hasLaterDay, breakfastSkipMark } from '../../src/ui/meals.js';
import { setBreakfast, takeBreakfastOffer } from '../../src/engine/breakfast.js';
import { stateOf, makeTrip, pois, THU, FRI, SAT, SUN, A, C, Z, D, E, F, G, H, I, late, dinner, dinner2, izakaya, cafe, bar, lunch, noodle, stand, bakery } from './_world.js';

const BREAKFASTS = [noodle.id, stand.id, bakery.id];
const stopOf = (state, date, id) => state.plans[date].plan.sequence.find((s) => s.poi.id === id) ?? assert.fail(`${date} 沒有 ${id}`);
const breakfastId = (state, date) => state.plans[date].plan.meals.breakfast;

test('這一站是哪一餐、是不是早餐卡：引擎先挑的早餐（鍵換成改天去／吃飯店早餐、換一家走早餐的清單）；午餐晚餐與不是哪一餐的站不是早餐卡；指定站當早餐不出那兩顆鍵', () => {
  const state = stateOf();
  const fri = state.plans[FRI].plan;
  assert.ok(BREAKFASTS.includes(fri.meals.breakfast), `FRI 引擎排了早餐：${fri.sequence.map((s) => s.poi.id).join('→')}`);
  const b = fri.sequence[0];
  assert.equal(b.poi.id, fri.meals.breakfast);
  assert.deepEqual([b.insertedBy, b.priority], ['engine', 'breakfast']);
  assert.equal(mealOf(fri, b), 'breakfast');
  assert.deepEqual(breakfastCardOf(fri, b), { kind: 'engine', keys: true, own: true });
  assert.equal(breakfastCardOf(fri, stopOf(state, FRI, D.id)), null);
  const thu = state.plans[THU].plan;
  assert.deepEqual([mealOf(thu, stopOf(state, THU, lunch.id)), mealOf(thu, stopOf(state, THU, dinner.id)), mealOf(thu, stopOf(state, THU, A.id)), mealOf(thu, stopOf(state, THU, bar.id))], ['lunch', 'dinner', null, null]);
  assert.equal(breakfastCardOf(thu, stopOf(state, THU, dinner.id)), null);
  assert.equal(breakfastCardOf(null, b), null);
  assert.equal(breakfastCardOf(fri, null), null);
  // 他勾的站自己落在早餐時段：picked；是指定站或主行程就不出「改天去／吃飯店早餐」（本來也沒有「不去了」），換一家照一般的走
  const meals = { breakfast: noodle.id, lunch: null, dinner: null };
  assert.deepEqual(breakfastCardOf({ meals }, { poi: noodle, priority: 'want' }), { kind: 'picked', keys: true, own: true });
  assert.deepEqual(breakfastCardOf({ meals }, { poi: noodle, priority: 'want', breakfast: true }), { kind: 'chosen', keys: true, own: true });
  assert.deepEqual(breakfastCardOf({ meals }, { poi: noodle, priority: 'want', designated: true }), { kind: 'picked', keys: false, own: false });
  assert.deepEqual(breakfastCardOf({ meals }, { poi: noodle, priority: 'must' }), { kind: 'picked', keys: true, own: false }, '必去的早餐：鍵照出，換一家不走早餐的寫法（引擎不替換必去站）');
});

test('換一家清單：晚餐的站最上面寫「晚餐換一家」、只列能當晚餐的店（店型不限）、有說明的多一行「可以當晚餐：…」；不是哪一餐的站不寫那一句、只列同店型', () => {
  const state = stateOf();
  const d = swapListOf(state, THU, stopOf(state, THU, dinner.id));
  assert.deepEqual([d.meal, d.title, d.breakfast], ['dinner', '晚餐換一家', false]);
  const names = d.cands.map((c) => c.poi.id);
  assert.ok(names.includes(dinner2.id) && names.includes(izakaya.id), `能當晚餐的兩家都列：${names.join('、')}`);
  assert.ok(!names.includes(cafe.id), '咖啡廳不列（原話 #195）');
  assert.equal(d.cands.find((c) => c.poi.id === izakaya.id).note, '可以當晚餐：串燒與釜飯，吃得飽', '不是吃的類也列，帶那一餐的說明');
  assert.equal(d.cands.find((c) => c.poi.id === dinner2.id).note, null, '吃的類本來就是正餐，沒有另外的說明就不多一行');
  assert.ok(d.cands.every((c) => typeof c.detourMin === 'number' && 'open' in c));
  const l = swapListOf(state, THU, stopOf(state, THU, lunch.id));
  assert.deepEqual([l.meal, l.title], ['lunch', '午餐換一家']);
  // 別天行程裡的店不列（11-12 畫面審查先擋引擎排的、11-17 連他勾的也擋）：三家早餐店都能當午餐、也順路，但各是 FRI／SAT／SUN 引擎排的早餐——選了它，那一天的早餐就被搶走
  assert.deepEqual(otherDaysStops(state.plans, THU).map((p) => p.id).sort(), [...BREAKFASTS, D.id, E.id, F.id, G.id, H.id, I.id].sort(), '別天序列裡的每一站：引擎排的早餐與他勾的街區');
  const friOthers = otherDaysStops(state.plans, FRI).map((p) => p.id);
  assert.ok(!friOthers.includes(breakfastId(state, FRI)) && !friOthers.includes(D.id) && !friOthers.includes(E.id), '自己那一天的不算');
  assert.ok(friOthers.includes(A.id) && friOthers.includes(F.id) && friOthers.includes(breakfastId(state, SAT)));
  assert.deepEqual(otherDaysStops({}, THU), []);
  // 別天勾了但排不進的（那天的排不進清單）也算別天行程裡的店；當天自己排不進的不算（清單照列，選了就是這一站換成它）
  const two = { x: { plan: { sequence: [{ poi: A }], dropped: [{ poi: C }] } }, y: { plan: { sequence: [{ poi: D }], dropped: [{ poi: E }] } } };
  assert.deepEqual([otherDaysStops(two, 'x').map((p) => p.id), otherDaysStops(two, 'y').map((p) => p.id)], [[D.id, E.id], [A.id, C.id]]);
  assert.ok(!l.cands.some((c) => BREAKFASTS.includes(c.poi.id)), `午餐清單不列別天的早餐：${l.cands.map((c) => c.poi.id).join('、')}`);
  // 那一家不再是哪一天引擎排的站（SUN 說了吃飯店早餐，那家空出來）就照列
  const sunB = breakfastId(state, SUN);
  const freed = stateOf(setBreakfast(makeTrip(), SUN, 'hotel', sunB));
  const l2 = swapListOf(freed, THU, stopOf(freed, THU, lunch.id));
  assert.ok(l2.cands.some((c) => c.poi.id === sunB), `空出來的那家列得到：${l2.cands.map((c) => c.poi.id).join('、')}`);
  assert.ok(!l2.cands.some((c) => c.poi.id === breakfastId(freed, FRI) || c.poi.id === breakfastId(freed, SAT)));
  // 清單是空的時候那一句照餐別寫，不是哪一餐才寫「同類型」；釘住的日子有候選卻全被試排濾掉的多半句
  assert.deepEqual([d.empty, l.cands.length, l.empty], ['附近沒有能當晚餐、順路又開著的店', 0, '附近沒有能當午餐、順路又開著的店（別天已經排了的店不列）'], '午餐清單是空的、候選（三家早餐店）都排在別天：多半句（11-17）');
  // 不是哪一餐：街區只換街區，沒有那一句
  const c = swapListOf(state, THU, stopOf(state, THU, C.id));
  assert.deepEqual([c.meal, c.title, c.breakfast], [null, null, false]);
  assert.ok(c.cands.length >= 1 && c.cands.every((x) => x.poi.category === 'street' && x.note === null), c.cands.map((x) => x.poi.id).join('、'));
  assert.ok(c.cands.some((x) => x.poi.id === Z.id));
  assert.equal(c.empty, '附近沒有同類型、順路又開著的店');
  // 酒吧不是哪一餐：只列酒吧
  const b = swapListOf(state, THU, stopOf(state, THU, bar.id));
  assert.equal(b.title, null);
  assert.ok(b.cands.every((x) => x.poi.category === 'bar'));
  assert.deepEqual(swapListOf(state, '2026-01-01', stopOf(state, THU, bar.id)), { meal: null, title: null, breakfast: false, cands: [], empty: '附近沒有同類型、順路又開著的店' });
  // 釘住的日子（THU）：有候選、卻全被「換了會害別的站排不進」濾掉時，那一句多半句。候選池只留一家要逛 600 分的街區：換掉 09:05 的街區A，午餐店（14:30 關）就排不進
  const longStreet = { ...Z, id: '逛很久的街區', name_zh: '逛很久的街區', dwellMin: 600 };
  const tight = { ...state, pool: [{ poi: longStreet }], pois: { ...state.pois, [longStreet.id]: longStreet } };
  const ta = swapListOf(tight, THU, stopOf(tight, THU, A.id));
  assert.deepEqual([ta.cands, ta.empty], [[], '附近沒有同類型、順路又開著的店（照你調過的順序，換了會害別的站排不進的不列）']);
  assert.equal(swapListOf({ ...tight, pool: [] }, THU, stopOf(tight, THU, A.id)).empty, '附近沒有同類型、順路又開著的店', '本來就沒有候選：不多那半句');
  // 兩個原因都有（別天排了的店不列、剩下的又被試排濾掉）：併成一個括號，不連接兩個括號（11-17 畫面審查）
  const both = { ...tight, pool: [...state.pool.filter((x) => x.poi.id !== Z.id), { poi: longStreet }] };
  assert.equal(swapListOf(both, THU, stopOf(both, THU, A.id)).empty, '附近沒有同類型、順路又開著的店（別天已經排了的店不列；照你調過的順序，換了會害別的站排不進的也不列）');
  assert.equal(mealNoteText('dinner', '點餐到 20:30'), '可以當晚餐：點餐到 20:30');
  assert.deepEqual([mealNoteText('dinner', null), mealNoteText(null, 'x'), mealNoteText('lunch', true)], [null, null, null]);
});

test('換一家清單不列別天行程裡的店（原話 #195 的推導，11-17）：別天他勾的站、同一處的另一筆都不列；在取前幾家之前就濾掉，空出來的位子由後面還沒排的店補上（不是清單變短）；釘住的日子照樣先試排', () => {
  const state = stateOf();
  // THU 的街區C（不是哪一餐、只列街區）：候選池照順序是 D E F G H I（FRI／SAT／SUN 勾的）再來才是沒勾過的 Z——之前前六家全是別天勾的站，選了同一家就兩天都有
  const c = swapListOf(state, THU, stopOf(state, THU, C.id));
  assert.deepEqual(c.cands.map((x) => x.poi.id), [Z.id], '別天勾的六家都不列，只剩沒排過的那一家');
  // 候選池再多八家沒排過的街區、一家「街區D 的另一筆」（同一處）：畫出來的是沒排過的前六家；同一處的不列
  const extras = Array.from({ length: 8 }, (_, i) => ({ ...Z, id: `新街區${i + 1}`, name_zh: `新街區${i + 1}` }));
  const twin = { ...Z, id: '街區D別館', name_zh: '街區D別館', samePlace: D.id };
  const more = [twin, ...extras];
  const big = { ...state, pool: [...state.pool, ...more.map((poi) => ({ poi }))], pois: { ...state.pois, ...Object.fromEntries(more.map((p) => [p.id, p])) } };
  const list = swapListOf(big, THU, stopOf(big, THU, C.id));
  assert.equal(SWAP_LIST_MAX, 6);
  assert.deepEqual(list.cands.map((x) => x.poi.id), [Z.id, ...extras.slice(0, 5).map((p) => p.id)], '補進來的是排在後面、還沒排的店');
  const elsewhere = new Set(otherDaysStops(big.plans, THU).map((p) => p.id));
  assert.ok(list.cands.every((x) => !elsewhere.has(x.poi.id) && x.poi.id !== twin.id));
  // 同一處的另一筆、店型跟別天那一站不一樣（知識庫常見：同一個地點一筆是街區、一筆是吃的）：別天那一站自己進不了這份清單，靠同一處這一條擋
  const stall = { ...dinner2, id: '街區D的食堂', name_zh: '街區D的食堂', samePlace: D.id };
  const withStall = { ...state, pool: [...state.pool, { poi: stall }], pois: { ...state.pois, [stall.id]: stall } };
  const dinners = swapListOf(withStall, THU, stopOf(withStall, THU, dinner.id)).cands.map((x) => x.poi.id);
  assert.ok(dinners.includes(dinner2.id) && !dinners.includes(stall.id), `街區D 排在 FRI，它同一處的食堂不列：${dinners.join('、')}`);
  const lone = { ...stall, samePlace: undefined };
  assert.ok(swapListOf({ ...withStall, pool: [...state.pool, { poi: lone }] }, THU, stopOf(withStall, THU, dinner.id)).cands.some((x) => x.poi.id === stall.id), '沒有標同一處的照列（對照）');
  // 別天沒排的那一天自己的清單：FRI 的街區D → 不列 THU／SAT／SUN 的街區，Z 照列
  const d = swapListOf(state, FRI, stopOf(state, FRI, D.id));
  assert.deepEqual(d.cands.map((x) => x.poi.id), [Z.id]);
  // 清單空了、而且有候選是因為排在別天才沒列：那一句多半句——只寫「附近沒有同類型的店」不是實情（附近有，只是別天排了）
  const noZ = { ...state, pool: state.pool.filter((x) => x.poi.id !== Z.id) };
  const none = swapListOf(noZ, FRI, stopOf(noZ, FRI, D.id));
  assert.deepEqual([none.cands, none.empty], [[], '附近沒有同類型、順路又開著的店（別天已經排了的店不列）']);
  const noneDinner = swapListOf({ ...state, pool: state.pool.filter((x) => ![dinner2.id, izakaya.id].includes(x.poi.id)) }, THU, stopOf(state, THU, dinner.id));
  assert.equal(noneDinner.cands.length, 0);
  assert.ok(['附近沒有能當晚餐、順路又開著的店', '附近沒有能當晚餐、順路又開著的店（別天已經排了的店不列）'].includes(noneDinner.empty), noneDinner.empty);
  assert.equal(swapListOf({ ...state, pool: [] }, FRI, stopOf(state, FRI, D.id)).empty, '附近沒有同類型、順路又開著的店', '本來就沒有候選：不多那半句');
  // 釘住的日子（THU）：每一家照樣先試排，湊滿六家就停；換了會害別的站排不進的不列、位子給後面的
  const long = { ...Z, id: '逛很久的街區', name_zh: '逛很久的街區', dwellMin: 600 };
  const tight = { ...state, pool: [{ poi: long }, ...extras.map((poi) => ({ poi }))], pois: { ...state.pois, [long.id]: long, ...Object.fromEntries(extras.map((p) => [p.id, p])) } };
  const ta = swapListOf(tight, THU, stopOf(tight, THU, A.id));
  assert.deepEqual(ta.cands.map((x) => x.poi.id), extras.slice(0, 6).map((p) => p.id), '排在最前面的那家換了會害午餐店排不進：不列，後面六家補滿');
});

test('hasLaterDay：旅程最後一天後面沒有日子（早餐卡不出「改天去」）；breakfastSkipMark：候選頁上被「吃飯店早餐／改天去」拿掉的勾選站那一句', () => {
  const trip = makeTrip();
  assert.deepEqual([THU, FRI, SAT, SUN].map((d) => hasLaterDay(trip, d)), [true, true, true, false]);
  assert.deepEqual([hasLaterDay(trip, '2026-08-17'), hasLaterDay(null, THU), hasLaterDay({ days: [] }, THU), hasLaterDay(trip, null)], [false, false, false, false]);
  // 他勾的站當早餐、按了吃飯店早餐／改天去：旅程檔那天的 breakfast.pick 記著被拿掉的那筆勾選
  const picked = { ...trip, days: trip.days.map((d) => (d.date === FRI ? { ...d, picks: [{ poiId: noodle.id, priority: 'want' }, ...d.picks] } : d)) };
  const hotel = setBreakfast(picked, FRI, 'hotel', noodle.id);
  assert.equal(breakfastSkipMark(hotel, noodle.id), '8/14（五） 早餐在飯店吃，這天不去');
  assert.equal(breakfastSkipMark(setBreakfast(picked, FRI, 'later', noodle.id), noodle.id), '8/14（五） 不排早餐，改天去');
  assert.equal(breakfastSkipMark(hotel, stand.id), null, '別家店不是');
  assert.equal(breakfastSkipMark(picked, noodle.id), null, '沒按過就沒有那一句');
  // 原定那家是引擎排的早餐（不在勾選裡，紀錄沒有 pick）：不是他勾的站，候選頁照舊
  assert.equal(breakfastSkipMark(setBreakfast(trip, FRI, 'hotel', noodle.id), noodle.id), null);
  assert.deepEqual([breakfastSkipMark(null, noodle.id), breakfastSkipMark(hotel, null), breakfastSkipMark({ days: [{ date: FRI, breakfast: { mode: 'hotel', poiId: null } }] }, noodle.id)], [null, null, null]);
  for (const s of [breakfastSkipMark(hotel, noodle.id), breakfastSkipMark(setBreakfast(picked, FRI, 'later', noodle.id), noodle.id)]) assert.doesNotMatch(s, /hotel|later|undefined|null|breakfast/, s);
});

test('早餐換一家：最上面寫「早餐換一家」、走早餐自己的清單（每家帶「可以當早餐：…」）、不列任何一天勾過或序列裡已經有的店；選了要走早餐的寫法', () => {
  // 三家早餐店三天各用一家：沒有別家可換。把 SUN 的早餐說成吃飯店（那家空出來、留給推薦），FRI 的清單就列得到它
  const base = stateOf();
  const sunB = breakfastId(base, SUN);
  const none = swapListOf(base, FRI, base.plans[FRI].plan.sequence[0]);
  assert.deepEqual([none.meal, none.title, none.breakfast, none.cands], ['breakfast', '早餐換一家', true, []], '別家都排在別天了：清單是空的（畫面寫「附近沒有…」那一句）');
  const state = stateOf(setBreakfast(makeTrip(), SUN, 'hotel', sunB));
  const list = swapListOf(state, FRI, state.plans[FRI].plan.sequence[0]);
  assert.deepEqual(list.cands.map((c) => [c.poi.id, c.note]), [[sunB, `可以當早餐：${sunB}的早餐`]]);
  assert.equal(list.breakfast, true);
  const ex = breakfastExclude(state.trip, state.plans);
  assert.ok(ex.has(D.id) && ex.has(breakfastId(state, FRI)) && ex.has(breakfastId(state, SAT)) && !ex.has(sunB), '任何一天勾過的＋任何一天序列裡的；空出來的那家不在裡面');
  assert.ok(!breakfastExclude({ days: [] }).size);
});

test('早餐卡上的「或 X」：改天去的那家在後面每個合格的日子都掛、吃飯店早餐只掛後面第一天；那天沒有早餐站的掛在日期下面；日期下面那行小字', () => {
  const base = stateOf();
  const friB = breakfastId(base, FRI); const satB = breakfastId(base, SAT); const sunB = breakfastId(base, SUN);
  assert.equal(new Set([friB, satB, sunB]).size, 3, '三天各一家');
  assert.equal(breakfastOffText(base.plans[FRI].day, pois), null, '照常排早餐的日子沒有那行小字');
  assert.deepEqual([offersOn(base.plans[SAT].plan, satB, pois), looseOffers(base.plans[SAT].plan, pois)], [[], []]);
  // 改天去：SAT、SUN 的早餐卡上各一行
  const later = stateOf(setBreakfast(makeTrip(), FRI, 'later', friB));
  assert.equal(later.plans[FRI].plan.meals.breakfast, null);
  assert.equal(breakfastOffText(later.plans[FRI].day, pois), `早餐這天不排（${friB} 改天去）`);
  for (const [date, cur] of [[SAT, satB], [SUN, sunB]]) {
    const rows = offersOn(later.plans[date].plan, cur, pois);
    assert.deepEqual(rows.map((x) => [x.poi.id, x.offer.fromDate, x.offer.replaces, x.note]), [[friB, FRI, cur, `可以當早餐：${friB}的早餐`]], date);
    assert.deepEqual(looseOffers(later.plans[date].plan, pois), []);
    assert.deepEqual(offersOn(later.plans[date].plan, D.id, pois), [], '只掛在早餐那一站上');
  }
  // 按了 SAT 的「或 X」：FRI 那行小字改寫成排到哪一天
  const taken = stateOf(takeBreakfastOffer(later.trip, SAT, friB, later.plans[SAT].plan));
  assert.equal(taken.plans[SAT].plan.meals.breakfast, friB);
  assert.equal(breakfastOffText(taken.plans[FRI].day, pois), `早餐這天不排（${friB} 改到 8/15（六） 去）`);
  assert.deepEqual(offersOn(taken.plans[SUN].plan, sunB, pois), [], '排走了就不再推薦');
  // 吃飯店早餐：只掛 SAT
  const hotel = stateOf(setBreakfast(makeTrip(), FRI, 'hotel', friB));
  assert.equal(breakfastOffText(hotel.plans[FRI].day, pois), '早餐在飯店吃');
  assert.deepEqual([offersOn(hotel.plans[SAT].plan, satB, pois).length, offersOn(hotel.plans[SUN].plan, sunB, pois).length], [1, 0]);
  // 原定那家是他自己勾的站（按了就從那天拿掉，記在旅程檔 breakfast.pick）：把店名寫出來（11-12 畫面審查）；引擎排的照舊不寫
  assert.equal(breakfastOffText(hotel.plans[FRI].day, pois, hotel.trip.days.find((x) => x.date === FRI)), '早餐在飯店吃', '原定那家是引擎排的：旅程檔沒有 pick');
  const own = { date: FRI, breakfast: { mode: 'hotel', poiId: noodle.id, at: 'x', pick: { poiId: noodle.id, priority: 'want' }, pickIndex: 0 } };
  assert.equal(pickedBreakfast(own, noodle.id), true);
  assert.deepEqual([pickedBreakfast(own, stand.id), pickedBreakfast({ breakfast: { mode: 'hotel', poiId: noodle.id } }, noodle.id), pickedBreakfast(null, noodle.id)], [false, false, false]);
  assert.equal(breakfastOffText({ breakfast: { mode: 'hotel', poiId: noodle.id, movedTo: null } }, pois, own), '早餐在飯店吃（麵店 這天不去）');
  assert.equal(breakfastOffText({ breakfast: { mode: 'hotel', poiId: noodle.id, movedTo: SUN } }, pois, own), '早餐在飯店吃（麵店 改到 8/16（日） 去）');
  assert.equal(breakfastOffText({ breakfast: { mode: 'hotel', poiId: noodle.id, movedTo: null } }, pois), '早餐在飯店吃', '沒給旅程檔那一天：照舊');
  // 那天沒排到早餐、他只是說在飯店吃（原定那家是 null）
  assert.equal(breakfastOffText({ breakfast: { mode: 'hotel', poiId: null, movedTo: null } }, pois), '早餐在飯店吃');
  assert.equal(breakfastOffText({ breakfast: { mode: 'later', poiId: null, movedTo: null } }, pois), '早餐這天不排');
  // SAT 沒有早餐站（他拒絕過引擎排的那家），第一站 11:00 才開、早上有空：推薦掛在日期下面（按了排在第一站，別的站不會因此晚）
  const trip = setBreakfast(makeTrip(), FRI, 'later', friB);
  const noSat = stateOf({ ...trip, days: trip.days.map((d) => (d.date === SAT ? { ...d, picks: [{ poiId: late.id, priority: 'want' }], removed: [{ poiId: satB, insertedBy: 'engine', priority: 'breakfast' }] } : d)) });
  assert.equal(noSat.plans[SAT].plan.meals.breakfast, null);
  const loose = looseOffers(noSat.plans[SAT].plan, pois);
  assert.deepEqual(loose.map((x) => [x.poi.id, x.offer.replaces, x.note]), [[friB, null, `可以當早餐：${friB}的早餐`]]);
  assert.deepEqual(looseOffers(noSat.plans[SAT].plan, {}), [], '知識庫沒有的店跳過');
  assert.deepEqual(looseOffers({ meals: { breakfast: null }, breakfastOffers: [] }, pois), []);
});
