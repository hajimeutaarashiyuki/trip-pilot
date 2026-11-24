// 餐段與早餐的畫面邏輯（11-06 第二批；主控 11-06 定的落地 C、D）。原話：
// #195「早中晚餐的換一間 應該要推薦對應餐廳吧 怎麼會爐端燒的換一間 推薦我咖啡廳 這可以當晚餐嗎 如果可以那也應該在簡介裡提及」
// #196「還有預設上每天都要有早餐的安排 但我也有可能在飯店吃早餐 所以早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」
// #197「所以某一天的早餐我在飯店吃了 原定的早餐沒去到 後續的其中一天在不影響原定行程的前提下 可以再推薦我一次」
// 這裡只有純函式（可測，不碰 DOM）：這一站是不是早餐卡、換一家清單該列誰與最上面那一句、早餐卡上的「或 X」、日期下面那行小字。
// 「這一站是哪一餐」一律看 plan.meals（rules/_slots.js，全引擎同一把尺）；寫回 state 在 app.js（swapStop、breakfastOff、breakfastBack、takeBreakfast），畫在 planner.js／now.js。
import { mealOfStop, mealNoteOf, MEAL_NAMES } from '../rules/_slots.js';
import { swapCandidates, samePlace } from '../engine/swap.js';
import { pinnedSwapCheck, breakfastSwapCheck, lockedPick } from '../engine/choices.js';
import { planArgsOf } from './plan-args.js';
import { breakfastKind, breakfastSwapCandidates } from '../engine/breakfast.js';
import { isLockedStop } from '../engine/insert.js';
import { pickedOrRemoved, resolveHome } from '../engine/trip.js';
import { TEXT } from './text.js';
import { dateLabel } from './dom.js';

/** 這一站是這天的哪一餐（'breakfast'｜'lunch'｜'dinner'），不是哪一餐回 null。 */
export function mealOf(plan, stop) {
  return mealOfStop(plan?.meals, stop?.poi?.id);
}

/**
 * 這一站是這天的早餐嗎：不是回 null；是回 { kind, keys, own }——
 * kind：'engine' 引擎先挑的（卡上多一句說明）｜'chosen' 他指定的（換過一家、按過「或 X」）｜'picked' 他勾的站自己落在早餐時段；
 * keys：鍵換成「改天去」「吃飯店早餐」（原話 #196，沒有「不去了」）——指定站與主行程本來就沒有「不去了」，早餐的這兩顆也不出；
 * own：「換一家」走早餐自己的清單與寫法（engine/breakfast.js：從住宿算繞路、每一家排成第一站試過；換了就變成他勾的）——
 *   必去、指定、主行程、固定時段的站引擎不替換（會另加一筆），那幾種照一般的「換一家」。
 */
export function breakfastCardOf(plan, stop) {
  if (!stop?.poi || mealOf(plan, stop) !== 'breakfast') return null;
  return { kind: breakfastKind(stop), keys: !stop.designated && !stop.isAnchor, own: !isLockedStop(stop) };
}

/** 那一餐的說明那一行（「可以當晚餐：拿坡里義大利麵、牛肉燴飯，點餐到 20:30」）：有說明才有，不分店型；沒有回 null。 */
export function mealNoteText(meal, note) {
  return meal && typeof note === 'string' && note ? TEXT.mealNote(MEAL_NAMES[meal] ?? '', note) : null;
}

/**
 * 早餐換一家的清單不列的店：任何一天勾過／按過「不去了」的 ∪ 任何一天序列裡的（含引擎插的）——列了的話，換過去會動到別天的行程。
 * plans＝state.plans（{ [date]: { plan } }）。
 */
export function breakfastExclude(trip, plans = {}) {
  const out = pickedOrRemoved(trip);
  for (const d of Object.values(plans ?? {})) for (const s of d?.plan?.sequence ?? []) if (s?.poi?.id) out.add(s.poi.id);
  return out;
}

/**
 * 這家店（或同一處的另一筆；知識庫 samePlace）現在在別天的哪裡：elsewhereOf(state, date) → (poi) → null（哪一天都還沒排）｜{ date, how, poiId, locked }。
 * - how：'placed' 別天他勾的、排進去了｜'dropped' 別天他勾了、沒排進（那天的「今天排不進」清單）｜'engine' 別天引擎排的（早餐、恢復站、填站、順路站、坐下來的地方）。
 * - poiId：別天那一站自己的 id（同一處的另一筆時跟 poi.id 不同）；locked：它在那天是必去、指定、主行程或帶固定時段的站（engine/choices.js lockedPick）——那一天不能少了它，不能挪。
 * - 同一家在好幾天都找得到時：他勾的先於引擎排的，再照日期由前到後。
 * 換一家清單拿它把別天已經排了的店排到後面、標日期（「8/15（六）已排」「8/13（四）勾了沒排進」），選了就是把它挪過來（engine/choices.js swapInPlace；主控 11-24 定）。
 * 11-17 那一版是整個不列（「換一家清單不列別天行程裡的店」）：落地後量到清單變很短——七天包畫出來的候選 101 → 48 筆、空清單 19 → 23 份，酒吧類的換一家全是空的，
 * 別天已經排進去的店也沒有任何一顆鍵能直接換過來——跟原話 #195「早中晚餐的換一間 應該要推薦對應餐廳吧…」要的背道而馳，主控收回。
 * state.plans＝{ [date]: { plan } }、state.trip＝旅程檔；date＝正在換的那一天（它自己序列裡的站 engine/swap.js 本來就不列）。
 */
export function elsewhereOf(state, date) {
  const rows = [];
  for (const d of state?.trip?.days ?? []) {
    if (!d?.date || d.date === date) continue;
    const plan = state.plans?.[d.date]?.plan;
    for (const s of plan?.sequence ?? []) if (s?.poi?.id) rows.push({ date: d.date, how: s.insertedBy ? 'engine' : 'placed', poi: s.poi, locked: !s.insertedBy && lockedPick(d, s.poi.id) });
    for (const q of plan?.dropped ?? []) if (q?.poi?.id) rows.push({ date: d.date, how: 'dropped', poi: q.poi, locked: lockedPick(d, q.poi.id) });
  }
  const mine = rows.filter((r) => r.how !== 'engine'); const engine = rows.filter((r) => r.how === 'engine');
  return (poi) => {
    const r = mine.find((x) => samePlace(x.poi, poi)) ?? engine.find((x) => samePlace(x.poi, poi));
    return r ? { date: r.date, how: r.how, poiId: r.poi.id, locked: r.locked } : null;
  };
}

/**
 * 換一家清單最多畫幾家（原本寫死在 planner.js 的 slice(0, 6)）。不該列的店都在取這幾家之前濾掉，空出來的位子由排在後面的店補上，不是清單變短。
 * 早餐自己的清單不受這個上限（11-24 傍晚主控裁決乙4；預設）：候選只有知識庫標了能當早餐的店、本來就少，合格的全列——之前第 7 家以後看不到
 * （原話 #198「可抽菸店家 都是可接受的」收進來的老喫茶 路傍 只在七天包 8/18 合格、排第 8 名）。早餐清單不另加多繞上限（預設：他自己挑的，清單上每家都寫多繞幾分）。
 */
export const SWAP_LIST_MAX = 6;

/**
 * 這一站按「換一家」要畫的清單：{ meal, title, breakfast, cands: [{ poi, detourMin, open, note, from, tag }], hint, empty }——cands 就是畫面上畫的那幾家
 * （最多 SWAP_LIST_MAX；早餐的清單不限）。
 * - meal：這一站是哪一餐（null＝不是哪一餐）；title：清單最上面那一句「晚餐換一家」「早餐換一家」，不是哪一餐就是 null（不寫）。
 * - hint：清單裡只要有一家帶小標（別天已經排了的店）就是那一句說明「標了日期的店原本在那一天，選了就挪到這裡」，畫在 title 下面（沒有 title 就在最上面）；
 *   一家都沒有是 null（11-24 傍晚主控定：整份清單六家全帶「8/17（一）已排」時他看不出選了會怎樣）。
 * - 早餐（breakfastCardOf().own）：engine/breakfast.js breakfastSwapCandidates（只列能當早餐、那時有開、離住宿不遠或順路、換了不會害別的站排不進的；整趟一家店只當一天的早餐，
 *   別天排了的不列——這一份清單不變）；breakfast: true＝選了要走早餐的寫法（app.js swapStop）。早餐是他勾的站自己落在早餐時段時換了是原位置換掉、把那天釘住（11-24 甲4），
 *   這種清單每一家也真的排一次才列（engine/choices.js breakfastSwapCheck）。合格的全列，不受 SWAP_LIST_MAX 限制。
 * - 其餘：engine/swap.js swapCandidates（午餐晚餐只列能當那一餐的店、店型不限；不是哪一餐只列同店型）。day 給了：主行程不在序列裡時也認得出活動日。
 *   先後（主控 11-24 定）：哪一天都還沒排的店在前（當天勾了但排不進的也算，選了就是這一站換成它），別天已經排了的店（elsewhereOf：他勾的——排進去的與勾了沒排進的——、引擎排的，
 *   含同一處的另一筆）排在後面，各自照 swapCandidates 的先後；取前 SWAP_LIST_MAX 家＝先取還沒排的，不滿才用別天已排的補。別天的必去、指定、主行程、固定時段的站不列（那一天不能少了它；推導）。
 *   每一家都真的換過去試排一次才列（engine/choices.js pinnedSwapCheck；11-24 起不分釘不釘住——換一家一律原位置換掉、把那天釘住）：照先後一家一家試、湊滿要畫的家數就停。
 * - from：別天已經排了的那幾家是 elsewhereOf 的那一筆（{ date, how, poiId }），其餘 null；tag：畫在店名後面的小標「8/15（六）已排」「8/13（四）勾了沒排進」，沒有是 null。
 * - note：候選那一餐的說明（mealNoteText），沒有是 null。
 * - empty：清單是空的時候寫哪一句——是某一餐的站寫「附近沒有能當晚餐、順路又開著的店」（餐段的換一家不分店型，不寫「同類型」）、不是哪一餐寫「附近沒有同類型…」；
 *   有候選卻全被試排濾掉時多半句（釘住的日子「（照你調過的順序，換了會害別的站排不進的不列）」、其餘「（換了會害別的站排不進的不列）」）。
 */
export function swapListOf(state, date, stop) {
  const planned = state.plans?.[date];
  const plan = planned?.plan;
  if (!plan || !stop?.poi) return { meal: null, title: null, breakfast: false, cands: [], hint: null, empty: TEXT.noSwap };
  const meal = mealOf(plan, stop);
  const breakfast = Boolean(breakfastCardOf(plan, stop)?.own);
  let listed; let fits;
  if (breakfast) {
    listed = breakfastSwapCandidates({ plan, day: planned.day, home: resolveHome(state.trip, date), pool: state.pool, legFn: state.legFn, rules: state.rules, settings: state.settings, country: state.country, kb: state.kb, exclude: [...breakfastExclude(state.trip, state.plans)] });
    // 早餐是他勾的站自己落在早餐時段：換了是把那天釘住、原位置換掉（11-24 甲4），每一家真的排一次才列；其餘的早餐清單 breakfastSwapCandidates 已經照那個排法試過，這裡原樣放行
    fits = breakfastSwapCheck({ trip: state.trip, date, plan, pois: state.pois, planArgs: planArgsOf(state) });
  } else {
    // adjust：那天在場的人不想去的店型（T19）——別類進來的不列，同類照列（他勾的那一類由他）
    const open = swapCandidates({ plan, stopId: stop.poi.id, pool: state.pool, legFn: state.legFn, date, settings: state.settings, adjust: planned.day?.adjust ?? null, day: planned.day });
    const where = elsewhereOf(state, date);
    const free = []; const moved = [];
    for (const c of open) { const from = where(c.poi); if (!from) free.push(c); else if (!from.locked) moved.push({ ...c, from }); }
    listed = [...free, ...moved];
    // baseline＝每天畫面上的那一版：帶小標的候選，它原本那天（照畫面釘住、少掉那一家）也一起試（11-24 甲1）
    fits = pinnedSwapCheck({ trip: state.trip, date, fromPoiId: stop.poi.id, plan, pois: state.pois, planArgs: planArgsOf(state), baseline: { days: Object.values(state.plans ?? {}) } });
  }
  const max = breakfast ? Infinity : SWAP_LIST_MAX;   // 早餐的清單合格的全列（11-24 傍晚主控裁決乙4）
  const cands = [];
  for (const c of listed) {
    if (cands.length >= max) break;
    if (fits(c.poi)) cands.push(c);
  }
  const cut = listed.length > 0 && cands.length === 0;
  const name = meal ? MEAL_NAMES[meal] ?? '' : '';
  return {
    meal, title: meal ? TEXT.swapTitle(name) : null, breakfast,
    cands: cands.map((c) => ({ poi: c.poi, detourMin: c.detourMin, open: c.open, note: mealNoteText(c.meal, c.mealNote), from: c.from ?? null, tag: c.from ? TEXT.swapElsewhere(dateLabel(c.from.date), c.from.how === 'dropped') : null })),
    hint: cands.some((c) => c.from) ? TEXT.swapMoveHint : null,
    empty: `${meal ? TEXT.noSwapMeal(name) : TEXT.noSwap}${cut ? (plan.pinned ? TEXT.noSwapPinnedTail : TEXT.noSwapFitTail) : ''}`,
  };
}

/**
 * 早餐卡上的「或 X（8/13 沒去的）」：plan.breakfastOffers 裡按了會換掉這一站的那幾筆（一天可以有兩筆）→ [{ offer, poi, note }]；
 * note＝X 能當早餐的那句說明（有才有）。知識庫沒有的店跳過。
 */
export function offersOn(plan, stopId, pois = {}) {
  return (plan?.breakfastOffers ?? []).filter((o) => o.replaces === stopId && pois[o.poiId]).map((o) => offerRow(o, pois));
}

/** 這天沒有早餐站、卻有推薦（按了就排在第一站）：日期下面那一行用。plan.breakfastOffers 裡不掛在哪一站上的那幾筆。 */
export function looseOffers(plan, pois = {}) {
  const current = plan?.meals?.breakfast ?? null;
  return (plan?.breakfastOffers ?? []).filter((o) => (o.replaces == null || o.replaces !== current) && pois[o.poiId]).map((o) => offerRow(o, pois));
}

const offerRow = (o, pois) => ({ offer: o, poi: pois[o.poiId], note: mealNoteText('breakfast', mealNoteOf(pois[o.poiId], 'breakfast')) });

/**
 * 日期下面那行小字（他說這天不排早餐；day＝planTrip 回的 day 上下文，day.breakfast { mode, poiId, movedTo }）：
 * 吃飯店早餐「早餐在飯店吃」；改天去「早餐這天不排（X 改天去）」、那家後來排到別天了寫「早餐這天不排（X 改到 8/14（五） 去）」。照常排早餐的日子回 null。
 * tripDay（選填）＝旅程檔那一天：吃飯店早餐而原定那家是他自己勾的站（days[].breakfast.pick 記著被拿掉的那筆勾選）時把店名寫出來——
 * 「早餐在飯店吃（X 這天不去）」、後來排到別天了寫「早餐在飯店吃（X 改到 8/14（五） 去）」。之前只寫「早餐在飯店吃」，他勾的那一站就這樣不見、哪裡都沒講是哪一站（11-12 畫面審查）；
 * 原定那家是引擎排的就照舊不寫店名（那不是他的行程）。
 */
export function breakfastOffText(day, pois = {}, tripDay = null) {
  const b = day?.breakfast;
  if (!b) return null;
  const L = TEXT.breakfast;
  const name = b.poiId ? (pois[b.poiId]?.name_zh ?? null) : null;
  if (b.mode === 'hotel') {
    if (!name || !pickedBreakfast(tripDay, b.poiId)) return L.offHotel;
    return b.movedTo ? L.offHotelMoved(name, dateLabel(b.movedTo)) : L.offHotelPicked(name);
  }
  return name && b.movedTo ? L.offMoved(name, dateLabel(b.movedTo)) : L.offLater(name);
}

/** 旅程檔那天不排早餐的紀錄裡，原定那家是不是他自己勾的站（被拿掉的那筆勾選記在 breakfast.pick；engine/breakfast.js setBreakfast）。 */
export function pickedBreakfast(tripDay, poiId) {
  const pick = tripDay?.breakfast?.pick;
  return Boolean(poiId) && Boolean(pick) && typeof pick === 'object' && pick.poiId === poiId;
}

/**
 * 這一天後面還有沒有別的日子（旅程檔 days 裡日期比它晚的）。旅程最後一天的早餐卡不出「改天去」（原話 #196 的推導，主控 11-17 定）：後面沒有日子可以去，
 * 按了只是那天不排早餐——那就是「吃飯店早餐」。規劃頁與現場頁共用。
 */
export function hasLaterDay(trip, date) {
  return Boolean(date) && (trip?.days ?? []).some((d) => typeof d?.date === 'string' && d.date > date);
}

/**
 * 候選頁：這家店是不是被「吃飯店早餐／改天去」從某一天拿掉的勾選站（旅程檔那天的 breakfast.pick 記著被拿掉的那筆勾選）——是就回那一句
 * 「8/15（六） 早餐在飯店吃，這天不去」／「8/18（二） 不排早餐，改天去」，不是回 null。之前候選頁對這種站寫「沒排進」，像是引擎排不進去；實情是他自己說這天不去
 * （11-12 畫面審查）。原定那家是引擎排的早餐不算（那不是他勾的站，候選頁本來就只標他勾的）；後來在別天排進去了，呼叫端先看到的是「已排 X」（pool.js）。
 */
export function breakfastSkipMark(trip, poiId) {
  if (!poiId) return null;
  const day = (trip?.days ?? []).find((d) => pickedBreakfast(d, poiId));
  if (!day) return null;
  const L = TEXT.breakfast;
  return day.breakfast.mode === 'later' ? L.poolLater(dateLabel(day.date)) : L.poolHotel(dateLabel(day.date));
}
