// 餐段與早餐的畫面邏輯（ui/meals.js；原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧…這可以當晚餐嗎 如果可以那也應該在簡介裡提及」、
// #196「早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」、#197 沒去到的後面再推薦一次）：純函式——
// 這一站是不是早餐卡、換一家清單最上面那一句與每家的說明、早餐卡上的「或 X」、日期下面那行小字。小世界見 _world.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealOf, breakfastCardOf, mealNoteText, breakfastExclude, swapListOf, elsewhereOf, SWAP_LIST_MAX, offersOn, looseOffers, breakfastOffText, pickedBreakfast, hasLaterDay, breakfastSkipMark } from '../../src/ui/meals.js';
import { setBreakfast, takeBreakfastOffer } from '../../src/engine/breakfast.js';
import { planTrip } from '../../src/engine/trip.js';
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
  // 這家店現在在別天的哪裡（elsewhereOf；換一家清單拿它標日期）：別天他勾的、引擎排的都找得到；自己那一天的、哪一天都沒排的回 null
  const where = elsewhereOf(state, THU);
  assert.deepEqual(where(D), { date: FRI, how: 'placed', poiId: D.id, locked: false });
  assert.deepEqual(where(pois[breakfastId(state, SAT)]), { date: SAT, how: 'engine', poiId: breakfastId(state, SAT), locked: false });
  assert.deepEqual([where(Z), where(A), where(null), elsewhereOf(state, FRI)(D), elsewhereOf({}, THU)(D)], [null, null, null, null, null], '沒排的、自己那一天的、沒資料：null');
  assert.deepEqual(elsewhereOf(state, FRI)(A), { date: THU, how: 'placed', poiId: A.id, locked: false });
  // 別天勾了但排不進的（那天的排不進清單）也找得到，標成沒排進；同一家在兩天都有時，他勾的先於引擎排的
  const two = { trip: { days: [{ date: 'x', picks: [{ poiId: A.id }, { poiId: C.id }] }, { date: 'y', picks: [{ poiId: E.id }] }, { date: 'z', picks: [{ poiId: D.id }] }] }, plans: { x: { plan: { sequence: [{ poi: A }, { poi: D, insertedBy: 'engine' }], dropped: [{ poi: C }] } }, y: { plan: { sequence: [], dropped: [{ poi: E }] } }, z: { plan: { sequence: [{ poi: D }], dropped: [] } } } };
  assert.deepEqual([elsewhereOf(two, 'y')(C), elsewhereOf(two, 'x')(E), elsewhereOf(two, 'y')(D)], [{ date: 'x', how: 'dropped', poiId: C.id, locked: false }, { date: 'y', how: 'dropped', poiId: E.id, locked: false }, { date: 'z', how: 'placed', poiId: D.id, locked: false }]);
  // 別天已經排了的店照列、排在後面、帶小標（11-24；11-17 那一版整個不列，這份午餐清單是空的）：三家早餐店都能當午餐、也順路，各是 FRI／SAT／SUN 引擎排的早餐
  assert.deepEqual(l.cands.map((c) => [c.poi.id, c.tag, c.from.how]), [[breakfastId(state, FRI), '8/14（五）已排', 'engine'], [breakfastId(state, SAT), '8/15（六）已排', 'engine'], [breakfastId(state, SUN), '8/16（日）已排', 'engine']]);
  assert.ok(d.cands.every((c) => c.tag === null && c.from === null), '哪一天都還沒排的店沒有小標');
  // 那一家不再是哪一天的站（SUN 說了吃飯店早餐，那家空出來）：沒有小標、排到前面
  const sunB = breakfastId(state, SUN);
  const freed = stateOf(setBreakfast(makeTrip(), SUN, 'hotel', sunB));
  const l2 = swapListOf(freed, THU, stopOf(freed, THU, lunch.id));
  assert.deepEqual(l2.cands.map((c) => [c.poi.id, c.tag]), [[sunB, null], [breakfastId(freed, FRI), '8/14（五）已排'], [breakfastId(freed, SAT), '8/15（六）已排']], '先列還沒排的，再列別天已排的');
  // 清單是空的時候那一句照餐別寫，不是哪一餐才寫「同類型」；「（別天已經排了的店不列）」那半句拿掉了
  const noLunch = swapListOf({ ...state, pool: state.pool.filter((x) => !BREAKFASTS.includes(x.poi.id)) }, THU, stopOf(state, THU, lunch.id));
  assert.deepEqual([d.empty, noLunch.cands.length, noLunch.empty], ['附近沒有能當晚餐、順路又開著的店', 0, '附近沒有能當午餐、順路又開著的店']);
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
  assert.deepEqual(swapListOf(state, '2026-01-01', stopOf(state, THU, bar.id)), { meal: null, title: null, breakfast: false, cands: [], hint: null, empty: '附近沒有同類型、順路又開著的店' });
  // 釘住的日子（THU）：有候選、卻全被「換了會害別的站排不進」濾掉時，那一句多半句。候選池只留一家要逛 600 分的街區：換掉 09:05 的街區A，午餐店（14:30 關）就排不進
  const longStreet = { ...Z, id: '逛很久的街區', name_zh: '逛很久的街區', dwellMin: 600 };
  const tight = { ...state, pool: [{ poi: longStreet }], pois: { ...state.pois, [longStreet.id]: longStreet } };
  const ta = swapListOf(tight, THU, stopOf(tight, THU, A.id));
  assert.deepEqual([ta.cands, ta.empty], [[], '附近沒有同類型、順路又開著的店（照你調過的順序，換了會害別的站排不進的不列）']);
  assert.equal(swapListOf({ ...tight, pool: [] }, THU, stopOf(tight, THU, A.id)).empty, '附近沒有同類型、順路又開著的店', '本來就沒有候選：不多那半句');
  // 沒釘住的日子（11-24 起也試排）：有候選卻全被濾掉時多的是另外那半句（那天還沒有「調過的順序」）。
  // FRI 兩個街區裡排在前面的那一個，換成「逛到 22:30」的街區（那個時段它自己開著、待得完）：後面那個街區（23:00 關）就排不進
  assert.ok(!state.plans[FRI].plan.pinned);
  const firstStreet = state.plans[FRI].plan.sequence.find((s) => [D.id, E.id].includes(s.poi.id));
  const veryLong = { ...Z, id: '逛到晚上的街區', name_zh: '逛到晚上的街區', dwellMin: 22 * 60 + 30 - firstStreet.startMin };
  const loose = { ...state, pool: [{ poi: veryLong }], pois: { ...state.pois, [veryLong.id]: veryLong } };
  const fa = swapListOf(loose, FRI, firstStreet);
  assert.deepEqual([fa.cands, fa.empty], [[], '附近沒有同類型、順路又開著的店（換了會害別的站排不進的不列）']);
  assert.equal(mealNoteText('dinner', '點餐到 20:30'), '可以當晚餐：點餐到 20:30');
  assert.deepEqual([mealNoteText('dinner', null), mealNoteText(null, 'x'), mealNoteText('lunch', true)], [null, null, null]);
});

test('換一家清單：別天已經排了的店不藏起來，列在後面、標日期（11-24，主控收回 11-17「別天行程裡的店不列」；原話 #195 要的是推薦對應的店）——先取還沒排的，不滿六家才用別天已排的補；同一處的另一筆也算別天已排；別天的必去、指定、主行程、固定時段不列；每一家都先試排', () => {
  const state = stateOf();
  const view = (list) => list.cands.map((x) => [x.poi.id, x.tag]);
  // THU 的街區C（不是哪一餐、只列街區）：候選池照順序是 D E F G H I（FRI／SAT／SUN 勾的）再來才是沒勾過的 Z。11-17 那一版只剩 Z 一家；現在 Z 在最前面，別天勾的排在後面、各帶小標
  const c = swapListOf(state, THU, stopOf(state, THU, C.id));
  assert.equal(SWAP_LIST_MAX, 6);
  assert.deepEqual(view(c), [[Z.id, null], [D.id, '8/14（五）已排'], [E.id, '8/14（五）已排'], [F.id, '8/15（六）已排'], [G.id, '8/15（六）已排'], [H.id, '8/16（日）已排']], '最多六家：還沒排的先、別天已排的補（街區I 沒排上）');
  assert.deepEqual(c.cands.map((x) => x.from), [null, ...[D, E].map((p) => ({ date: FRI, how: 'placed', poiId: p.id, locked: false })), ...[F, G].map((p) => ({ date: SAT, how: 'placed', poiId: p.id, locked: false })), { date: SUN, how: 'placed', poiId: H.id, locked: false }]);
  // 候選池再多八家沒排過的街區：畫出來的六家全是還沒排的——別天已排的只在不滿六家時才補
  const extras = Array.from({ length: 8 }, (_, i) => ({ ...Z, id: `新街區${i + 1}`, name_zh: `新街區${i + 1}` }));
  const withMore = (more) => ({ ...state, pool: [...state.pool, ...more.map((poi) => ({ poi }))], pois: { ...state.pois, ...Object.fromEntries(more.map((p) => [p.id, p])) } });
  const big = withMore(extras);
  assert.deepEqual(view(swapListOf(big, THU, stopOf(big, THU, C.id))), [Z.id, ...extras.slice(0, 5).map((p) => p.id)].map((id) => [id, null]));
  // 還沒排的有四家：補兩家別天已排的
  const four = withMore(extras.slice(0, 3));
  assert.deepEqual(view(swapListOf(four, THU, stopOf(four, THU, C.id))), [[Z.id, null], ...extras.slice(0, 3).map((p) => [p.id, null]), [D.id, '8/14（五）已排'], [E.id, '8/14（五）已排']]);
  // 同一處的另一筆（知識庫 samePlace）：街區D 排在 FRI，它的別館算別天已排——排在後面、標那一天，from.poiId 是那天那一站自己的 id
  const twin = { ...Z, id: '街區D別館', name_zh: '街區D別館', samePlace: D.id };
  const tw = { ...state, pool: [{ poi: twin }, { poi: Z }, { poi: D }], pois: { ...state.pois, [twin.id]: twin } };
  const twList = swapListOf(tw, THU, stopOf(tw, THU, C.id));
  assert.deepEqual(view(twList), [[Z.id, null], [twin.id, '8/14（五）已排']], '還沒排的在最前面；別館帶街區D 那一天的小標（同一處的兩筆只列一筆——排在前面的那一筆）');
  assert.deepEqual(twList.cands[1].from, { date: FRI, how: 'placed', poiId: D.id, locked: false });
  // 同一處的另一筆、店型跟別天那一站不一樣（同一個地點一筆是街區、一筆是吃的）：晚餐清單上它也帶小標
  const stall = { ...dinner2, id: '街區D的食堂', name_zh: '街區D的食堂', samePlace: D.id };
  const ws = withMore([stall]);
  assert.deepEqual(view(swapListOf(ws, THU, stopOf(ws, THU, dinner.id))), [[dinner2.id, null], [izakaya.id, null], [stall.id, '8/14（五）已排']]);
  // 別天勾了但沒排進的：標「勾了沒排進」。SAT 勾三家咖啡廳（同類一天最多 2 家）有一家排不進；FRI 那家咖啡廳的清單三家都列得到
  const mkCafe = (id, over = {}) => ({ ...cafe, id, name_zh: id, curated: true, item: '咖啡豆', ...over });
  const cafes = ['咖啡一', '咖啡二', '咖啡三'].map((id) => mkCafe(id)); const friCafe = mkCafe('咖啡四');
  const cafeState = (satOver = {}) => {
    const trip = makeTrip();
    Object.assign(trip.days.find((x) => x.date === SAT), { picks: [F, G, ...cafes].map((p) => ({ poiId: p.id, priority: 'want' })), ...satOver });
    trip.days.find((x) => x.date === FRI).picks.push({ poiId: friCafe.id, priority: 'want' });
    const s = stateOf(trip);
    return { ...s, pois: { ...s.pois, ...Object.fromEntries([...cafes, friCafe].map((p) => [p.id, p])) }, pool: [...s.pool, ...[...cafes, friCafe].map((poi) => ({ poi }))] };
  };
  // stateOf 用小世界自己的知識庫排：把四家咖啡廳加進去再排一次
  const planWith = (s) => ({ ...s, plans: Object.fromEntries(planTrip({ trip: s.trip, pois: s.pois, rules: s.rules, settings: s.settings, country: s.country, kb: s.kb, legFn: s.legFn, restPool: Object.values(s.pois) }).days.map((x) => [x.date, x])) });
  const cs = planWith(cafeState());
  const out = cs.plans[SAT].plan.dropped.map((x) => x.poi.id);
  assert.equal(out.length, 1, `SAT 排不進的咖啡廳：${out.join('、')}`);
  const friList = swapListOf(cs, FRI, stopOf(cs, FRI, friCafe.id));
  assert.deepEqual(Object.fromEntries(view(friList)), Object.fromEntries(cafes.map((p) => [p.id, p.id === out[0] ? '8/15（六）勾了沒排進' : '8/15（六）已排'])));
  assert.equal(friList.cands.find((x) => x.poi.id === out[0]).from.how, 'dropped');
  // 別天的必去、主行程、指定站、帶固定時段的：不列（那一天不能少了它；挪不走）
  const lockedOf = (satOver, pickOver = {}) => {
    const s0 = cafeState(satOver);
    const sat = s0.trip.days.find((x) => x.date === SAT);
    sat.picks = sat.picks.map((p) => (p.poiId === cafes[0].id ? { ...p, ...pickOver } : p));
    const s = planWith(s0);
    return swapListOf(s, FRI, stopOf(s, FRI, friCafe.id)).cands.map((x) => x.poi.id);
  };
  assert.ok(lockedOf({}).includes(cafes[0].id), '對照：一般的勾選照列');
  for (const [label, satOver, pickOver] of [['必去', {}, { priority: 'must' }], ['指定', { designated: [cafes[0].id] }, {}], ['主行程', { anchor: { poiId: cafes[0].id } }, {}], ['固定時段', {}, { fixedWindow: { startMin: 900 } }]]) {
    assert.ok(!lockedOf(satOver, pickOver).includes(cafes[0].id), `${label}：不列`);
  }
  // 每一家都先試排（釘住的 THU）：換了會害別的站排不進的不列，位子給後面的——還沒排的與別天已排的都要試
  const long = { ...Z, id: '逛很久的街區', name_zh: '逛很久的街區', dwellMin: 600 };
  const tight = { ...state, pool: [{ poi: long }, ...extras.map((poi) => ({ poi }))], pois: { ...state.pois, [long.id]: long, ...Object.fromEntries(extras.map((p) => [p.id, p])) } };
  assert.deepEqual(swapListOf(tight, THU, stopOf(tight, THU, A.id)).cands.map((x) => x.poi.id), extras.slice(0, 6).map((p) => p.id), '排在最前面的那家換了會害午餐店排不進：不列，後面六家補滿');
  // 真的沒有店：照既有的句子（「別天已經排了的店不列」那半句拿掉了）
  assert.equal(swapListOf({ ...state, pool: [] }, FRI, stopOf(state, FRI, D.id)).empty, '附近沒有同類型、順路又開著的店');
  // 小標的說明（11-24 傍晚主控定；主控截圖看整份清單六家全帶「8/17（一）已排」，看不出選了會怎樣）：清單裡只要有一家帶小標就有這一句，一家都沒有就沒有
  const HINT = '標了日期的店原本在那一天，選了就挪到這裡';
  assert.equal(c.hint, HINT, '六家裡五家帶小標');
  assert.equal(friList.hint, HINT, '勾了沒排進的也是帶小標的');
  assert.equal(swapListOf(big, THU, stopOf(big, THU, C.id)).hint, null, '畫出來的六家都還沒排：不寫');
  assert.equal(swapListOf(state, THU, stopOf(state, THU, dinner.id)).hint, null, '晚餐清單沒有帶小標的');
  assert.equal(swapListOf({ ...state, pool: [] }, FRI, stopOf(state, FRI, D.id)).hint, null, '空清單不寫');
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
  // 早餐的清單不受「最多 6 家」限制，合格的全列（11-24 傍晚主控裁決乙4：候選只有知識庫標了能當早餐的店，本來就少；之前第 7 家以後看不到——七天包 8/18 的 路傍）。
  // 候選池多八家能當早餐的店：連空出來的那一家共九家都列，先後照早餐清單既有的（多繞少的在前，一樣照候選池的先後）；沒有小標、也就沒有小標的說明
  const more = Array.from({ length: 8 }, (_, i) => ({ ...noodle, id: `早餐店${i + 1}`, name_zh: `早餐店${i + 1}`, meals: { breakfast: true, lunch: true } }));
  const wide = { ...state, pool: [...state.pool, ...more.map((poi) => ({ poi }))], pois: { ...state.pois, ...Object.fromEntries(more.map((p) => [p.id, p])) } };
  const all = swapListOf(wide, FRI, wide.plans[FRI].plan.sequence[0]);
  assert.ok(all.cands.length > SWAP_LIST_MAX);
  assert.deepEqual(all.cands.map((x) => x.poi.id), [sunB, ...more.map((p) => p.id)].sort((a, b) => wide.pool.findIndex((x) => x.poi.id === a) - wide.pool.findIndex((x) => x.poi.id === b)));
  assert.deepEqual([all.hint, all.cands.every((x) => x.tag === null)], [null, true]);
  // 別的清單照舊最多 6 家（同一批店也能當午餐：THU 的午餐清單只畫六家）
  assert.equal(swapListOf(wide, THU, stopOf(wide, THU, lunch.id)).cands.length, SWAP_LIST_MAX);
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
