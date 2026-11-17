// 早餐（11-06 第二批；主控 11-06 定的落地 D）。原話：
// #196「還有預設上每天都要有早餐的安排 但我也有可能在飯店吃早餐 所以早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」
// #197「所以某一天的早餐我在飯店吃了 原定的早餐沒去到 後續的其中一天在不影響原定行程的前提下 可以再推薦我一次」
// 這推翻 DESIGN §11.1 Q4「早餐不管、不替你挑店」（那是他當時照單全收的提案＝預設；現在有原話）。
//
// 國家層 country.mealSlots 有 breakfast 這一段才有早餐這回事（rules/_slots.js breakfastSlotOf）；沒有這個鍵時 engine/trip.js 不會呼叫這裡的排法，舊打包檔的結果不變。
// 這一檔四件事，都是純函式（不改傳入的東西）；不 import engine/trip.js（引擎插站的門由 trip.js 傳進來）：
// 1. 引擎替他排早餐：每天的站都排完之後（搜尋、順路站都做完），要早餐、他勾的站裡又沒有一站算早餐的日子，從知識庫挑一家安插成第一站——
//    breakfastOptions（這天哪幾家排得進、照先後排好）→ assignBreakfasts（整趟一起分，一家店只當一天的早餐）。安插不重新搜尋（tryBreakfastFirst）：原本的每一站都留著、先後不變，
//    只是時刻往後順延；有站因此撞硬規則就不排這一家（主控定「排不進（會害別的站排不進）就不排」）。
// 2. 推薦（原話 #197）：他按過「吃飯店早餐」「改天去」的那家（旅程檔 days[].breakfast 記著），在後面的日子掛「或 X」——breakfastOffers。
// 3. 早餐那一站的「換一家」清單——breakfastSwapCandidates（從住宿算繞路、每一家真的排成第一站試過）。
// 4. 旅程檔的動作：setBreakfast（吃飯店早餐／改天去）、clearBreakfast（改回來）、takeBreakfastOffer（按了「或 X」）、swapBreakfast（早餐換一家）。
//    畫面呼叫完拿新的 trip 整趟重排（ui/app.js 的事）。
//
// 為什麼是「排完再安插」（11-12 實跑，段 K 待套用版知識庫 11-12 00:27 那一版打的三個包；每天時間預算放大到 5000 ms 比結果、預設 800 ms 各跑 5 次取中位數比毫秒）：
// - 甲 排完再安插成第一站（採用）：要早餐的 10 個日子排到 8 天；他勾的站少 0 站；其餘各站先後變了 0 天；整包 1375／568／875 ms（七天包／公務版／試走版）。
// - 乙 前 3 名候選當 optional 丟進搜尋（另加一條硬規則只准它當第一站）：排到 7 天；他勾的站少 2 站（七天包 8/13 珈巣多夢、公務版 8/13 火星之庭）；
//   他勾的站先後變了 4 天；1979／1246／1015 ms，七天包有一天撞 800 ms 截斷。
// - 丙 先釘第一名早餐、其餘的站從早餐店出發重新搜尋：排到 10 天；他勾的站少 2 站（公務版 8/13 火星之庭、8/14 研討會會場——主行程）；他勾的站先後變了 4 天；1268／672／872 ms。
// 乙、丙都是為了早餐把整天重排、還會擠掉他勾的站。原話 #197 推薦那一句要的是「在不影響原定行程的前提下」；#192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」講的是順路站升級，
// 同一個意思類推到早餐（推導）。甲按了「吃飯店早餐」之後其餘各站就是沒有早餐的樣子。
//
// 旅程檔多的欄位：
// - days[].breakfast = { mode: 'hotel'｜'later', poiId: 原定那家或 null, at, pick?, pickIndex?, movedTo? }
//   那天不排早餐、不提示；poiId 那家別天引擎不主動拿去當早餐（留給推薦）。pick／pickIndex：原定那家是他勾的站時，被拿掉的那筆勾選與它原本的位置（「改回來」放回去用）；
//   movedTo：按了「或 X」排到哪一天（有了就不再推薦）。
// - days[].picks[].breakfast = true：他指定這一筆當那天的早餐（按了「或 X」、或把早餐換一家）。這一筆不進搜尋，排完之後安插成第一站；引擎那天不再另挑。
//   排成第一站會害別的站排不進時，它落到那天的排不進清單、引擎另挑一家。
// - days[].swapped[] 的那一筆多 breakfast: true：被換掉的是早餐（換一家、按了「或 X」頂掉的）。引擎之後整趟不再主動拿它當早餐（blockedBreakfasts）。
// - days[].engineBreakfast = '<poi id>'：上一版引擎替這天挑的早餐（畫面每次重排完用 keepBreakfasts 記回來；打包檔裡沒有這一欄）。之後重排時那一家在那天還排得進、
//   沒被佔走就沿用（assignBreakfasts 的 keep），排不進的那天才重挑——不沿用的話整趟每次都重新分，他只動了一天、別天的早餐卻跟著換店（11-12 畫面審查；數字在 assignBreakfasts 的註解）。
// 排進去的 stop：引擎挑的帶 insertedBy 'engine'、priority 'breakfast'、optional；他指定的帶 breakfast: true、priority 照那筆勾選、optional（不佔每天 8 站的名額——
// 引擎插的站本來就不算，原話 #163；他指定的早餐比照，不然換一家早餐會把晚上的站擠進排不進）。兩種都另帶 detourMin（比直接去第一站多繞幾分）。
// 「哪一站是這天的早餐」一律看 plan.meals.breakfast（rules/_slots.js mealAssignments；他勾的站自己落在早餐時段的也算）——breakfastOfPlan、breakfastKind。
import { openIntervals } from './time.js';
import { retimeSequence, evaluateSequence, rawWindowDay } from './sequence.js';
import { personAvoids } from './persons.js';
import { samePlace, swapGated } from './swap.js';
import { servesMeal, mealAssignments, breakfastSlotOf, breakfastOffOf, lastTrainMisses, BREAKFAST_OFF_MODES } from '../rules/_slots.js';
import { researchRank } from '../rules/_helpers.js';

/** 引擎替他排的早餐在 stop.priority 上的值（engine/core.js PRIORITY_VALUE 有這個鍵、價值 0；rules/_slots.js 靠它把引擎排的早餐算成早餐）。 */
export const BREAKFAST_PRIORITY = 'breakfast';

/**
 * 引擎排早餐的做法（11-11 實跑比過才取的，數字在各函式的註解）：
 * giveWay 'fill'＝早餐安插後只有填站讓位（縮短，不拿掉）；順路站、恢復站、他勾的站都不動（tryBreakfastFirst）。
 * order 'best'＝整趟的早餐把每一種分法都試過、挑最好的（assignBreakfasts）。
 * 下面每個函式沒另外給就用這一組；engine/trip.js 排的、推薦驗的、換一家清單試的才會是同一套。
 */
export const BREAKFAST_POLICY = Object.freeze({ giveWay: 'fill', order: 'best' });

const legMin = (l) => (l?.walkMin ?? 0) + (l?.rideMin ?? 0) + (l?.waitMin ?? 0);
const walkOnly = (l) => (l && (l.rideMin ?? 0) === 0 ? (l.walkMin ?? 0) + (l.waitMin ?? 0) : null);

/**
 * 旅程檔那天的 breakfast 欄位（他按過「吃飯店早餐」「改天去」）：形狀對才回 { mode, poiId, at, pick, pickIndex, movedTo }，沒有或寫壞回 null（當作那天照常排早餐）。
 * poiId 是原定那家（字串）或 null（那天本來就沒排到早餐，他只是說在飯店吃）。
 */
export function breakfastChoiceOf(tripDay) {
  const b = tripDay?.breakfast;
  if (!b || typeof b !== 'object' || Array.isArray(b) || !BREAKFAST_OFF_MODES.includes(b.mode)) return null;
  return {
    mode: b.mode,
    poiId: typeof b.poiId === 'string' && b.poiId ? b.poiId : null,
    at: typeof b.at === 'string' ? b.at : null,
    pick: b.pick && typeof b.pick === 'object' && !Array.isArray(b.pick) && typeof b.pick.poiId === 'string' ? b.pick : null,
    pickIndex: Number.isInteger(b.pickIndex) && b.pickIndex >= 0 ? b.pickIndex : null,
    movedTo: typeof b.movedTo === 'string' && b.movedTo ? b.movedTo : null,
  };
}

/** 這家店能當早餐（知識庫 meals.breakfast；推導不給早餐）。國家層有早餐段時，引擎的恢復站、填站、順路站三個池不拿這些店——留給早餐（engine/trip.js）。 */
export function servesBreakfast(poi) {
  return servesMeal(poi, 'breakfast') !== false;
}

/** 這家店的營業時間不固定（知識庫 closeRisk: 'irregular'：賣完就收、臨時休、各來源時段對不上；profile §5.12）。引擎挑早餐時同一級裡排後面（主控 11-11 定：先排比較確定會開的）。 */
export function closesIrregularly(poi) {
  return poi?.closeRisk === 'irregular';
}

/** 排成早餐的那一站的樣子。engine＝引擎挑的（價值 0、可拒絕）；不是就是他指定的那筆勾選（pick）。停留：勾選寫的 → 店自己的 → settings.breakfastDefaultDwellMin（預設 40）。 */
export function breakfastStop(poi, settings = {}, pick = null) {
  const own = Number(pick?.dwellMin ?? poi?.dwellMin);
  const dwellMin = Number.isFinite(own) && own > 0 ? own : (settings.breakfastDefaultDwellMin ?? 40);
  const base = { poi, dwellMin, optional: true, isAnchor: false, designated: false, fixedWindow: null, gap: null, errand: false, deferredFrom: null };
  return pick ? { ...base, priority: pick.priority ?? 'want', insertedBy: null, breakfast: true } : { ...base, priority: BREAKFAST_PRIORITY, insertedBy: 'engine' };
}

/** 這一站是排成第一站的早餐嗎（引擎挑的，或他指定的那筆）。他勾的站自己落在早餐時窗的不算——那一種看 plan.meals.breakfast。 */
export function isPlacedBreakfast(stop) {
  return Boolean(stop) && ((stop.insertedBy === 'engine' && stop.priority === BREAKFAST_PRIORITY) || stop.breakfast === true);
}

/** 這天的早餐站（plan.meals.breakfast 對回序列裡的那一站）；這天沒有早餐回 null。畫面拿它決定哪一張站卡要換成早餐的鍵（改天去、吃飯店早餐、換一家）。 */
export function breakfastOfPlan(plan) {
  const id = plan?.meals?.breakfast;
  return id ? (plan.sequence ?? []).find((s) => s.poi.id === id) ?? null : null;
}

/**
 * 這個早餐站是誰排的：'engine' 引擎替他挑的（換了就變成他勾的）、'chosen' 他指定的（按了「或 X」或換過一家；picks[].breakfast）、
 * 'picked' 他勾的站自己落在早餐時段（8/18 他勾的仙台朝市那種）。三種的鍵都一樣（改天去、吃飯店早餐、換一家）；差別只有卡上要不要寫「引擎排的」。
 */
export function breakfastKind(stop) {
  if (!stop) return null;
  return stop.insertedBy === 'engine' ? 'engine' : stop.breakfast === true ? 'chosen' : 'picked';
}

/**
 * 早餐排在第一站、下一站卻要等（等開門、等卡位時刻）時，把早餐往後挪到「吃完走過去剛好」：晚一點出門，不是吃完去門口站著等
 * （引擎每一站都盡早開始；第一站等開門會改成晚點出門——engine/schedule.js——但第二站不會，所以早餐排第一站時要自己補這一步）。
 * 最多挪到：下一站不用等、早餐還在它的營業時間內、早餐在早餐段結束前吃完（until 'core'：日本 10:00；'window' 是放寬後的時窗 11:00、'none' 不挪）。其餘各站的時刻不動。
 * 取 'core'（11-11 實跑比過、11-12 換成最後的知識庫重跑相同；三個打包檔只有公務版 8/13 有差——那天早上沒排站、第一站是 11:30 的牛舌午餐）：不挪是 09:02–09:22 吃早餐、在牛舌店門口等 113 分（那天 543.5 分）；
 * 挪到早餐段結束前是 09:40–10:00、等 75 分（543.5 分），出門時間還在預設的 09:00–10:00 以內（原話 #17）；挪到放寬後的時窗是 10:40–11:00 才吃早餐、11:30 接著吃午餐（565.5 分，多一句「今天 10:38 才出門」）。
 * 分數最高的是最後一種，但早餐吃完半小時就吃午餐不像早餐，所以取中間那一種。
 * 回新的序列（不適用就回原陣列）。重定時刻（retimeSequence）之後要再呼叫一次——時刻是算出來存在序列裡的，重定會回到盡早。
 */
export function alignBreakfast(sequence, { day, settings = null, country = null, until = 'core' } = {}) {
  const b = sequence?.[0]; const next = sequence?.[1];
  if (until === 'none' || !isPlacedBreakfast(b) || !next || !(next.waitMin > 0) || b.fixedWindow) return sequence;
  const slot = breakfastSlotOf(country, settings);
  const iv = openIntervals(b.poi, day?.date);
  const cur = Array.isArray(iv) ? iv.find(([o, c]) => b.startMin >= o && b.endMin <= c) : null;
  const latest = slot ? (until === 'window' ? slot.window[1] : slot.core[1]) : Infinity;
  const room = Math.min(next.waitMin, cur ? cur[1] - b.endMin : Infinity, latest - b.endMin);
  if (!(room > 0)) return sequence;
  const shifted = { ...b, arriveMin: (b.arriveMin ?? b.startMin) + room, startMin: b.startMin + room, endMin: b.endMin + room };
  const eased = { ...next, arriveMin: (next.arriveMin ?? next.startMin) + room, waitMin: next.waitMin - room };
  return [shifted, eased, ...sequence.slice(2)];
}

/** 整條重定時刻再把早餐對齊（retimeSequence＋alignBreakfast）：早餐排在第一站的那天要重定時刻時用這個。 */
export function retimeWithBreakfast(args) {
  return alignBreakfast(retimeSequence(args), args);
}

/**
 * 把 stop 排成這天的第一站試試看（不重新搜尋：他勾的每一站都留著、先後不變，整條重定時刻、整天重算）。
 * 回 { ok: true, trial, ev, walkMin, detourMin, shiftMaxMin, displaced, shrunk } 或 { ok: false, why, msg? }。排得進的條件：
 * - 走得到：從住宿走路就到（'ride'：要搭車才到得了的不當早餐——先吃再上車）。near { maxWalkMin, maxDetourMin } 給了才看位置（'far'：離住宿走路超過 maxWalkMin、
 *   比直接去第一站多繞又超過 maxDetourMin）——引擎挑店與換一家清單給，他自己指定的、推薦的不給（他要去的店不嫌遠）。
 * - 那個時刻開著夠它停留：沒有營業時間資料的不排（'hours-unknown'：不知道開不開的不插，跟順路站同一條）、當天沒開的不排（'closed-today'）；
 *   出門走到的時候還沒開的（'closed'）只有在「等它開門也不會讓別的站晚」時才排——第一站本來就晚開、早上有空的日子；不然等它開門會把整天往後推。
 * - 沒有站撞硬規則（'hard'，msg 是那一句：超過關門、趕不上固定時段、超過收工…；早餐這一站自己撞的是 'self'）；原本成立的一天不能變成不成立（'day'，整天層級的硬規則）；
 *   趕不上末班車的站不能變多（'last-train'：他勾的站不受規則擋，站層級看不到）。
 * - 排進去之後它真的是這天的早餐（'not-breakfast'：落在早餐放寬後的時窗裡、沒被午餐搶走）。
 * giveWay（引擎自己插的站要不要讓位；'none' 都不讓、預設 BREAKFAST_POLICY.giveWay＝'fill'。他勾的站、恢復站、坐下來的地方一律不讓）：
 * - 'fill'：填站是拿來填等開門的空檔的（engine/trip.js fillCandidates：停留本來就是照空檔的長度裁的），早餐佔掉一段，填站就短一點——
 *   它不能超出那段空檔（硬規則 filler-gap），也不能把它在等的那一站拖過開門時刻；最短縮到 settings.fillMinGapMin（15）分，不拿掉。縮短的列在 shrunk [{ poiId, dwellMin }]。
 * - 'onway'：先照 'fill' 做；還是有站撞硬規則，就把順路站（priority 'onway'）先拿掉再試——順路站是有空才排的（原話 #170「如果有順路的話 直接就排行程進去」），早餐比它要緊。
 *   拿掉的列在 displaced（stop 陣列）；早餐排定之後由呼叫端再跑一次順路站（engine/trip.js），排得進的照樣排回來。
 * shiftMaxMin：留下來的站開始時刻最多晚了幾分（跟傳進來的時刻比）。addedWaitMin：排進去之後各站等開門的分鐘合計多了幾分（早餐已經挪到早餐段結束前，還是填不滿到下一站開門的那一段）。
 * maxAddedWaitMin（選填，預設 null＝不看）：給了數字，多等超過它就回 { ok: false, why: 'wait', addedWaitMin }——11-12 審查提的門（比照填站、順路站「不能害後面的站等」，原話 #164 那一條的推導）。
 * 引擎挑店時由 settings.breakfastMaxAddedWaitMin 決定給不給（現在沒設）；他指定的早餐、推薦、換一家清單都不給（他要去的店不替他擋）。
 * 公務版 8/13「早餐後在牛舌店門口等 75 分」那件事不是靠這道門解的：根因是太晚出門沒有觸發填站、早上整段空著（engine/trip.js FILL_TRIGGERS，11-12 修）。
 */
export function tryBreakfastFirst({ sequence = [], stop, day, home, legFn, rules, settings = {}, country = null, kb = null, complete = true, giveWay = BREAKFAST_POLICY.giveWay, near = null, maxAddedWaitMin = null }) {
  const poi = stop?.poi;
  if (!poi || !legFn) return { ok: false, why: 'no-poi' };
  const walkMin = walkOnly(legFn(home, poi));
  if (walkMin == null) return { ok: false, why: 'ride' };
  const iv = openIntervals(poi, day.date);
  if (iv === null) return { ok: false, why: 'hours-unknown' };
  if (!iv.length) return { ok: false, why: 'closed-today' };
  const arrive = day.window.startMin + walkMin;
  const first = sequence[0]?.poi ?? null;
  const detourMin = first ? Math.max(0, walkMin + legMin(legFn(poi, first)) - legMin(legFn(home, first))) : walkMin;
  if (near && !(walkMin <= near.maxWalkMin || detourMin <= near.maxDetourMin)) return { ok: false, why: 'far', walkMin, detourMin };
  const placed = { ...stop, detourMin };
  const was = new Map(sequence.map((s) => [s.poi.id, s.startMin]));
  const missBefore = lastTrainMisses({ sequence, day, home, legFn }).length;
  const minFill = settings.fillMinGapMin ?? 15;
  const fillOn = giveWay === 'fill' || giveWay === 'onway';
  const isOnway = (s) => s.insertedBy === 'engine' && s.priority === 'onway';
  const build = (rest) => {
    const timed = retimeSequence({ sequence: [placed, ...rest], day, home, legFn, settings, country, kb });
    return { trial: alignBreakfast(timed, { day, settings, country }), opensLate: timed[0].startMin > arrive };   // opensLate：走到的時候還沒開，排程把它改成晚點出門
  };
  const settle = (restIn) => {
    let rest = restIn; const shrunk = new Map();
    let cur = build(rest);
    for (let guard = 0; fillOn && guard < 8; guard++) {
      let hit = null;
      for (let k = 1; k < cur.trial.length && !hit; k++) {
        const f = cur.trial[k]; const next = cur.trial[k + 1];
        if (!(f.insertedBy && f.priority === 'filler' && f.gap)) continue;
        const outside = f.endMin - f.gap.endMin;   // 超出它的空檔
        const dragging = next && (was.get(next.poi.id) ?? Infinity) <= f.gap.endMin ? next.startMin - f.gap.endMin : 0;   // 它在等的那一站被拖過了開門時刻
        const left = Math.max(minFill, f.dwellMin - Math.max(outside, dragging));
        if (left < f.dwellMin) hit = { id: f.poi.id, left };
      }
      if (!hit) break;
      rest = rest.map((s) => (s.poi.id === hit.id ? { ...s, dwellMin: hit.left } : s));
      shrunk.set(hit.id, hit.left);
      cur = build(rest);
    }
    const ev = evaluateSequence({ sequence: cur.trial, day, home, legFn, rules, settings, country, kb });
    return { ...cur, ev, bad: ev.breakdown.stops.map((s, i) => (s.verdict !== 'ok' ? i : -1)).filter((i) => i >= 0), shrunk };
  };
  let s = settle(sequence); let displaced = [];
  if (giveWay === 'onway' && (s.bad.length || (complete && !s.ev.complete)) && sequence.some(isOnway)) {
    const lighter = settle(sequence.filter((x) => !isOnway(x)));
    if (!lighter.bad.length && (lighter.ev.complete || !complete)) { s = lighter; displaced = sequence.filter(isOnway); }
  }
  const { trial, ev, bad, opensLate } = s;
  if (bad.length) {
    const at = trial[bad[0]];
    const msg = ev.warnings.find((w) => w.code === 'hard' && w.poiId === at.poi.id)?.msg ?? null;
    return { ok: false, why: bad[0] === 0 ? 'self' : 'hard', poiId: at.poi.id, msg };   // 'self'：早餐這一站自己撞硬規則（待不完就關門、同類的店超過上限…）
  }
  if (complete && !ev.complete) return { ok: false, why: 'day', msg: ev.warnings.find((w) => w.code === 'hard')?.msg ?? null };
  if (lastTrainMisses({ sequence: trial, day, home, legFn }).length > missBefore) return { ok: false, why: 'last-train' };
  if (mealAssignments({ sequence: trial, day, settings, country }).meals.breakfast !== poi.id) return { ok: false, why: 'not-breakfast' };
  let shiftMaxMin = 0;
  for (const x of trial.slice(1)) shiftMaxMin = Math.max(shiftMaxMin, x.startMin - (was.get(x.poi.id) ?? x.startMin));
  if (opensLate && shiftMaxMin > 0) return { ok: false, why: 'closed' };
  const waitOf = (list) => list.reduce((n, x) => n + (x.waitMin ?? 0), 0);
  const addedWaitMin = Math.max(0, waitOf(trial) - waitOf(sequence));
  if (Number.isFinite(maxAddedWaitMin) && addedWaitMin > maxAddedWaitMin) return { ok: false, why: 'wait', addedWaitMin };
  return { ok: true, trial, ev, walkMin, detourMin, shiftMaxMin, addedWaitMin, displaced, shrunk: [...s.shrunk].map(([poiId, dwellMin]) => ({ poiId, dwellMin })) };
}

/**
 * 釘住順序的日子（旅程檔 days[].pinned；engine/insert.js）換早餐用：把 stop 放在序列的第 index 個位置試試看——index＝現在早餐的位置（sequence 是拿掉現在那一站早餐之後的），
 * 那天沒早餐就是 0。不重新搜尋、其餘各站先後不動，整條重定時刻、整天重算；收工線用原時窗（釘住的日子本來就准用留白，rawWindowDay）。
 * 填站、順路站都不讓位（釘住的順序裡它們就是一站）。條件跟 tryBreakfastFirst 同一批：從前一站（第一站＝住宿）走得到、有營業時間而且今天有開、near 給了才看位置
 * （離住宿走路 ≤ maxWalkMin 或比直接走多繞 ≤ maxDetourMin）、沒有站撞硬規則、原本成立的一天沒變成不成立、趕不上末班車的站沒變多、排進去之後它真的是這天的早餐、
 * 到的時候還沒開而且會害別的站晚的不排。回的形狀同 tryBreakfastFirst（displaced、shrunk 一律是空的）。
 */
export function tryBreakfastAt({ sequence = [], index = 0, stop, day, home, legFn, rules, settings = {}, country = null, kb = null, complete = true, near = null }) {
  const poi = stop?.poi;
  if (!poi || !legFn) return { ok: false, why: 'no-poi' };
  const at = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, sequence.length));
  const evalDay = rawWindowDay(day);
  const prev = at > 0 ? sequence[at - 1].poi : home;
  const next = sequence[at]?.poi ?? null;
  const walkIn = walkOnly(legFn(prev, poi));
  if (walkIn == null) return { ok: false, why: 'ride' };
  const iv = openIntervals(poi, day.date);
  if (iv === null) return { ok: false, why: 'hours-unknown' };
  if (!iv.length) return { ok: false, why: 'closed-today' };
  const homeWalk = walkOnly(legFn(home, poi));
  const detourMin = next ? Math.max(0, walkIn + legMin(legFn(poi, next)) - legMin(legFn(prev, next))) : walkIn;
  if (near && !((homeWalk != null && homeWalk <= near.maxWalkMin) || detourMin <= near.maxDetourMin)) return { ok: false, why: 'far', walkMin: homeWalk, detourMin };
  const was = new Map(sequence.map((s) => [s.poi.id, s.startMin]));
  const missBefore = lastTrainMisses({ sequence, day: evalDay, home, legFn }).length;
  const trial = retimeWithBreakfast({ sequence: [...sequence.slice(0, at), { ...stop, detourMin }, ...sequence.slice(at)], day: evalDay, home, legFn, settings, country, kb });
  const ev = evaluateSequence({ sequence: trial, day: evalDay, home, legFn, rules, settings, country, kb });
  const bad = ev.breakdown.stops.map((s, i) => (s.verdict !== 'ok' ? i : -1)).filter((i) => i >= 0);
  if (bad.length) {
    const hit = trial[bad[0]];
    return { ok: false, why: bad[0] === at ? 'self' : 'hard', poiId: hit.poi.id, msg: ev.warnings.find((w) => w.code === 'hard' && w.poiId === hit.poi.id)?.msg ?? null };
  }
  if (complete && !ev.complete) return { ok: false, why: 'day', msg: ev.warnings.find((w) => w.code === 'hard')?.msg ?? null };
  if (lastTrainMisses({ sequence: trial, day: evalDay, home, legFn }).length > missBefore) return { ok: false, why: 'last-train' };
  if (mealAssignments({ sequence: trial, day, settings, country }).meals.breakfast !== poi.id) return { ok: false, why: 'not-breakfast' };
  let shiftMaxMin = 0;
  for (const x of trial) if (x.poi.id !== poi.id) shiftMaxMin = Math.max(shiftMaxMin, x.startMin - (was.get(x.poi.id) ?? x.startMin));
  const opensLate = at === 0 ? trial[0].startMin > evalDay.window.startMin + walkIn : (trial[at].waitMin ?? 0) > 0;
  if (opensLate && shiftMaxMin > 0) return { ok: false, why: 'closed' };
  return { ok: true, trial, ev, walkMin: homeWalk ?? walkIn, detourMin, shiftMaxMin, displaced: [], shrunk: [] };
}

/** 先後的鍵比大小（陣列逐項比）。 */
function byKey(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/**
 * 這一天引擎可以排成早餐的店，照先後排好。回 [{ poi, stop, trial, ev, walkMin, detourMin, shiftMaxMin, displaced, shrunk, rank, irregular }]（都是排得進的）。
 * 候選的門：能當早餐（知識庫 meals.breakfast）、過引擎插站的門（mayInsert＝engine/trip.js engineMayInsert：挖寶型、評 ≤2 星、落選兩次、還沒解鎖、代購研究站、
 * 研究判可略過、不是一個地點的都不拿——14 家能當早餐的仙台站沒有一筆帶 item，那一道擋不擋結果相同，照原樣）、在場的人不避的店型、不在 excluded（呼叫端給的函式：
 * 任何一天勾過／不去了的、任何一天序列裡的、這天換掉過的、按過「我進去了」的，連同一處的另一筆——知識庫欄位 samePlace）。
 * 位置：離住宿走路 ≤ settings.breakfastWalkMaxMin（預設 12），或在去第一站的路上（比直接去多繞 ≤ settings.onTheWayDetourMin，原話 #184 的 8 分）。
 * 排不排得進：tryBreakfastFirst（那個時刻開著夠它停留、沒有站因此撞硬規則；填站照 giveWay 讓位）。settings.breakfastMaxAddedWaitMin 有設才多一道
 * 「不能害後面的站多等開門」的門（現在沒設＝不擋；理由與實跑數字在 rules.json 那個鍵的說明）。每個候選多帶 addedWaitMin（排進去之後各站等開門合計多了幾分）。
 * 分數差太多的（poor：不合這天）往後排、不拿掉：見函式裡 breakfastScoreSlackMin 那一段。每個候選多帶 poor（boolean）。
 * 先後（主控 11-11 定，推導；11-12 審查後 poor 從硬門改成一級）：備案最後（researchRank 'backup'——只有那天沒有別家可排時才輪得到）→ 不合這天的排後面（poor）
 * → 研究首選在前（'first'）、沒標的其次 → 比較確定會開的在前（closeRisk 'irregular' 的排後面）→ 多繞的分鐘少的在前（一樣就離住宿近的）→ 整天分數高的。
 * 不只比分數：停留短的（外帶飯糰 10 分）會佔便宜。
 */
export function breakfastOptions({ sequence = [], complete = true, pool = [], day, home, legFn, rules, settings = {}, country = null, kb = null, mayInsert = () => true, excluded = () => false, giveWay = BREAKFAST_POLICY.giveWay }) {
  const near = { maxWalkMin: settings.breakfastWalkMaxMin ?? 12, maxDetourMin: settings.onTheWayDetourMin ?? 8 };
  const out = [];
  for (const poi of pool) {
    if (!poi || !servesBreakfast(poi) || !mayInsert(poi) || personAvoids(day?.adjust, poi) || excluded(poi)) continue;
    const r = tryBreakfastFirst({ sequence, stop: breakfastStop(poi, settings), day, home, legFn, rules, settings, country, kb, complete, giveWay, near, maxAddedWaitMin: settings.breakfastMaxAddedWaitMin ?? null });
    if (!r.ok) continue;
    out.push({ poi, stop: r.trial[0], trial: r.trial, ev: r.ev, walkMin: r.walkMin, detourMin: r.detourMin, shiftMaxMin: r.shiftMaxMin, addedWaitMin: r.addedWaitMin, displaced: r.displaced, shrunk: r.shrunk, rank: researchRank(poi), irregular: closesIrregularly(poi) });
  }
  // 不合這天的店（poor）：讓這天的分數比最好的那家差超過 settings.breakfastScoreSlackMin（預設 30）。先後把分數排在最後，不另外標的話，營業固定但很不合這天的店會贏過合適的。
  // 七天包實測（11-11）：8/13 そば処 福はら（東口，那天的區域外）532.5 分、當天最好的 617.25；8/14 Cafe de 埃比昂 接在他勾的埃比昂 東一店前面（兩家咖啡廳連著）556 分、當天最好的 611.75；合適的幾家彼此差不到 21 分。
  // 11-11 的做法是直接不收（硬門），11-12 審查指出它會蓋過主控定的先後——(a) 備案贏過排得進的非備案（七天包把四家首選當成去過：8/13 排了備案 imosen，福はら 排得進卻被濾掉）；
  // (b) 明明有店排得進，那天卻只剩「今天沒排早餐」（公務版同一個情境：門檻只留 DaTe，DaTe 被別天拿走）。主控定的是「備案只有沒別家時才用」「排不進（會害別的站排不進）才不排」。
  // 所以改成只往後排、不拿掉：先後多一級——沒排到 ＞ 用備案 ＞ 不合這天 ＞ 其餘照舊（assignBreakfasts 的合計同一個先後）。合適的店夠分時結果跟硬門一樣；不夠分時先用不合這天的，再不行才用備案。
  // 比的基準是非備案裡最好的那一家（沒有非備案才拿全部的比）：備案分數再高，也不會把排得進的非備案標成不合。只跟這天自己比——這天每一家都差，就都不算不合。
  const slack = settings.breakfastScoreSlackMin ?? 30;
  const regular = out.filter((o) => o.rank < 2);
  const basis = (regular.length ? regular : out).reduce((m, o) => Math.max(m, o.ev.score), -Infinity);
  for (const o of out) o.poor = Number.isFinite(slack) && o.ev.score < basis - slack;
  const key = (o) => [o.rank === 2 ? 1 : 0, o.poor ? 1 : 0, o.rank, o.irregular ? 1 : 0, o.detourMin, o.walkMin, -o.ev.score];
  return out.map((o, i) => ({ o, i })).sort((x, y) => byKey(key(x.o), key(y.o)) || x.i - y.i).map(({ o }) => o);
}

/**
 * 整趟的早餐一起分：一家店只當一天的早餐（同一處的另一筆也算同一家——samePlace）。
 * days [{ date, options }]（options＝breakfastOptions 排好的；要引擎排早餐的日子才放進來）、taken＝已經被佔走的店（POI 陣列：別天他勾的早餐、他記著要改天去的那幾家）。
 * 回 Map<date, option>（沒分到的日子不在裡面）。
 * order 'best'（採用）：把每一種分法都試過，挑整趟最好的——先比排得到早餐的天數（多的好），再照主控定的先後逐項比整趟的合計：用到備案的天數少、
 * 用到「不合那天」的店的天數少（option.poor；11-12 審查後從硬門改成這一級）、研究首選的天數多、
 * 營業不固定的天數少、多繞的分鐘合計少、離住宿的分鐘合計少、分數合計高；都一樣就照日期由前到後、挑各天排比較前面的那一家（答案只有一個）。
 * 只開某幾天的店（朝市週日與盂蘭盆休）自然落在它有開的日子：把每天都開的那家留給只剩它能排的日子，排得到早餐的天數才會最多。
 * 另外兩種是比過沒採用的：'date' 照日期先到先得、'scarce' 選擇少的日子先挑（都是每天拿自己排最前面、還沒被佔走的那一家）。
 * 11-11 實跑、11-12 換成最後的知識庫重跑相同（七天包 8/13、8/14、8/16 三天要引擎排；盂蘭盆與週日，營業固定又在住宿旁邊的只有 そばの神田、立ちそば処 杜、Cafe de 埃比昂 三家）：
 * 'date'＝8/13 神田、8/14 杜、8/16 埃比昂；'scarce'＝8/14 神田、8/16 杜，最後輪到 8/13 只剩營業不固定的外帶飯糰（おにぎり処 あみ）——明明三天都分得到營業固定的；
 * 'best'＝8/13 杜、8/14 神田、8/16 埃比昂（三天都營業固定，多繞合計 16 分；'date' 那一種是 20 分）。公務版與試走版三種結果相同。
 * 幾天、幾家都很少（仙台七天包 3 天、每天 3～5 家），全部試過也只有幾百種；超過 ASSIGN_MAX_NODES 就停、用當下最好的（'scarce' 的結果墊底）。
 * 他按了「吃飯店早餐」之後那家變成被佔走、那天不再分：其餘各天分到的店不變——原本的分法扣掉那一天，就是新題目的最好分法（合計是各天相加的，那一天的那一項兩邊相同）。
 * keep（選填；Map<date, poi id> 或 { [date]: poi id }）＝上一版每天引擎排的早餐（旅程檔 days[].engineBreakfast，breakfastKeepOf）：那一家還在那天的 options 裡（還排得進）、
 * 沒被佔走，就先定下來（照日期由前到後），剩下的日子才照 order 分。11-12 畫面審查：三天搶三家店，任何一天的行程一變，各家的繞路與分數合計就變、整趟重新洗牌——
 * 他在 8/14 按一站「不去了」，8/14 與 8/16 的早餐就互換（神田↔Cafe de 埃比昂），畫面沒有一句話。待套用版七天包每一站各按一次不去了（50 次）、每份換一家清單前六家各選一次，
 * 別天的早餐換店：不沿用 11 次／19 次（換一家已不列別天引擎排的站，92 次），沿用 0 次／0 次；動到的那天自己的早餐換店 15→9 次、25→11 次。
 * 代價：動到的那天原本那一家排不進時，只能從別天沒用的店裡挑（七天包 8/13 會退到營業不固定的外帶飯糰），不會為了它去動別天——他只動了這一天，別天不該跟著變
 * （跟 putBreakfast 擋住被換掉的早餐同一個取捨）；整趟分數合計平均每個動作少 3.7 分（50 次不去了合計 −3783 對 −3598）。「只沿用別天、動到的那天重挑」也跑過，結果逐筆相同，取不用知道動了哪一天的這一種。
 */
export function assignBreakfasts({ days: allDays = [], taken = [], order = BREAKFAST_POLICY.order, keep = null } = {}) {
  const blocked = [...taken].filter(Boolean);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  // 沿用上一版：先把還排得進的定下來，佔走那幾家店
  const kept = new Map();
  if (keep) {
    for (const d of [...allDays].sort(byDate)) {
      const id = keep instanceof Map ? keep.get(d.date) : keep[d.date];
      const o = typeof id === 'string' && id ? d.options.find((x) => x.poi.id === id) : null;
      if (o && !blocked.some((u) => samePlace(u, o.poi))) { kept.set(d.date, o); blocked.push(o.poi); }
    }
  }
  const days = kept.size ? allDays.filter((d) => !kept.has(d.date)) : allDays;
  const withKept = (m) => { for (const [date, o] of kept) m.set(date, o); return m; };
  const count = (d) => [d.options.filter((o) => o.rank < 2).length, d.options.length, d.date];
  const scarce = [...days].sort((a, b) => byKey(count(a), count(b)));
  const greedy = (queue) => {
    const used = [...blocked]; const out = new Map();
    for (const d of queue) {
      const pick = d.options.find((o) => !used.some((u) => samePlace(u, o.poi)));
      if (pick) { out.set(d.date, pick); used.push(pick.poi); }
    }
    return out;
  };
  if (order === 'date') return withKept(greedy([...days].sort(byDate)));
  if (order === 'scarce') return withKept(greedy(scarce));
  // 整趟合計的鍵（小的好）：沒排到的天數、備案天數、不合那天的天數（poor；breakfastOptions 標的）、−首選天數、不固定天數、多繞合計、離住宿合計、−分數合計，再接各天挑的是第幾家（照日期）
  const dated = [...days].sort(byDate);
  const keyOf = (pickOf) => {
    const k = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const d of dated) {
      const o = pickOf.get(d.date);
      if (!o) { k[0] += 1; continue; }
      if (o.rank === 2) k[1] += 1;
      if (o.poor) k[2] += 1;
      if (o.rank === 0) k[3] -= 1;
      if (o.irregular) k[4] += 1;
      k[5] += o.detourMin; k[6] += o.walkMin; k[7] -= o.ev.score;
    }
    for (const d of dated) { const o = pickOf.get(d.date); k.push(o ? d.options.indexOf(o) : Infinity); }
    return k;
  };
  let best = greedy(scarce); let bestKey = keyOf(best);
  let nodes = 0;
  const cur = new Map(); const used = [...blocked];
  const walk = (i) => {
    if (nodes++ > ASSIGN_MAX_NODES) return;
    if (i === scarce.length) {
      const k = keyOf(cur);
      if (byKey(k, bestKey) < 0) { best = new Map(cur); bestKey = k; }
      return;
    }
    const d = scarce[i];
    for (const o of d.options) {
      if (used.some((u) => samePlace(u, o.poi))) continue;
      cur.set(d.date, o); used.push(o.poi);
      walk(i + 1);
      cur.delete(d.date); used.pop();
    }
    walk(i + 1);   // 這天不排（把店讓給別天）也是一種分法
  };
  walk(0);
  return withKept(best);
}
/** 整趟早餐的分法最多試幾種（assignBreakfasts）：平常遠遠用不到；天數多、每天家數也多的長旅程才會碰到，碰到就用當下最好的。 */
const ASSIGN_MAX_NODES = 50000;

/**
 * 推薦（原話 #197；主控定的落地 D4、D5）：他按過「吃飯店早餐」「改天去」而記著的那家，在後面的日子掛「或 X」。回 Map<date, [{ poiId, fromDate, mode, replaces, detourMin, shiftMin }]>。
 * - entries [{ fromDate, mode, poi }]：還記著的（呼叫端已經扣掉排走的、已經被勾進哪一天的、知識庫沒有的）。
 * - days [{ date, day, plan, home, visited, replanWithout? }]：排好的每一天（plan 是早餐安插完的）；visited＝那天之前按過「我進去了」的店 id（去過的不再推薦，原話 #138）；
 *   replanWithout(poiId)＝這天少勾那一站會排成什麼樣的 plan（engine/trip.js 給的；見下面「他勾的站」那一條）。
 * - 'hotel'：只掛在後面第一個合格的日子（#197「可以再推薦我一次」）；'later'：後面每個合格的日子都掛（他明講要去；推導）。都不自動動到那天的行程，他按了才換。
 * - 合格：那天要早餐（早餐段在時窗內、沒被固定時段蓋住、不是他說不排的日子）；那天的早餐不是他必去／指定／主行程／固定時段的站、也不是同一處的另一筆；
 *   把那天的早餐換成 X（X 排成第一站；tryBreakfastFirst：X 那時開著、沒有站撞硬規則）之後，其餘各站先後不變、沒有站多掉進排不進、
 *   開始時刻最多比現在晚 settings.breakfastOfferShiftMaxMin（預設 10）分（引擎填的站不算：它是填空檔的，早餐排進來它就往後挪、短一點；釘住的日子照算）。
 *   · 那天的早餐是引擎排的、他之前指定的、或那天沒早餐：其餘各站本來就不是跟著早餐排的，直接拿現在的序列試。
 *   · 那天的早餐是他勾的站自己落在早餐時段（跟別的站一起搜尋排出來的）：把它換掉之後其餘的站會重新搜尋，所以真的少勾那一站排一次（replanWithout）再試；
 *     排出來其餘各站的先後跟現在不一樣、或有站因此排不進，就不掛。沒給 replanWithout 的呼叫端（單獨測這個函式）退回拿現在的序列試。
 * - replaces＝那天現在的早餐站 id（引擎排的或他勾的），那天沒早餐是 null；detourMin＝X 比直接去第一站多繞幾分；shiftMin＝其餘各站最多比現在晚幾分。
 * giveWay：填站要不要讓位，預設跟引擎排早餐時同一個設定（BREAKFAST_POLICY）——按了之後重排用的就是那個設定，這裡要一樣才對得起來。
 */
export function breakfastOffers({ entries = [], days = [], legFn, rules, settings = {}, country = null, kb = null, giveWay = BREAKFAST_POLICY.giveWay }) {
  const out = new Map();
  if (!breakfastSlotOf(country, settings)) return out;
  const ctx = { legFn, rules, settings, country, kb, giveWay };
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of entries) {
    if (!e?.poi || !BREAKFAST_OFF_MODES.includes(e.mode)) continue;
    for (const d of sorted) {
      if (!(d.date > e.fromDate)) continue;
      const fit = breakfastFitOn(e.poi, d, ctx);
      if (!fit) continue;
      out.set(d.date, [...(out.get(d.date) ?? []), { poiId: e.poi.id, fromDate: e.fromDate, mode: e.mode, replaces: fit.replaces, detourMin: fit.detourMin, shiftMin: fit.shiftMin }]);
      if (e.mode === 'hotel') break;
    }
  }
  return out;
}

/**
 * 把 poi 排成 d 那天的早餐合不合格（breakfastOffers 與 breakfastFitDays 共用的那一步；條件就是 breakfastOffers 註解裡「合格」那一條）：
 * 合格回 { replaces, detourMin, shiftMin }，不合格回 null。d＝breakfastOffers 的 days 的一筆（{ date, day, plan, home, visited, replanWithout?, pinned? }）。
 */
function breakfastFitOn(poi, d, { legFn, rules, settings = {}, country = null, kb = null, giveWay = BREAKFAST_POLICY.giveWay }) {
  if (!d.plan?.sequence || (d.visited ?? []).includes(poi.id)) return null;
  const maxShift = settings.breakfastOfferShiftMaxMin ?? 10;
  const ids = (list) => list.map((s) => s.poi.id).join('|');
  const seq = d.plan.sequence;
  const a = mealAssignments({ sequence: seq, day: d.day, settings, country });
  if (!('breakfast' in a.meals) || a.notNeeded.breakfast) return null;
  const cur = a.stops.breakfast ?? null;
  if (cur && (cur.priority === 'must' || cur.designated || cur.isAnchor || cur.fixedWindow || samePlace(cur.poi, poi))) return null;
  const others = cur ? seq.filter((s) => s !== cur) : seq;
  const offered = breakfastStop(poi, settings, { poiId: poi.id, priority: 'want' });
  let r;
  if (d.pinned) {
    // 釘住順序的日子（engine/insert.js）：那天不重新搜尋，按了就是原位置換掉（沒早餐就排在第一站）——照那個樣子試
    r = tryBreakfastAt({ sequence: others, index: cur ? seq.indexOf(cur) : 0, stop: offered, day: d.day, home: d.home, legFn, rules, settings, country, kb, complete: d.plan.complete !== false });
  } else {
    let base = others; let complete = d.plan.complete !== false;
    if (cur && !isPlacedBreakfast(cur) && typeof d.replanWithout === 'function') {
      const again = d.replanWithout(cur.poi.id);
      const before = new Set((d.plan.dropped ?? []).map((x) => x.poi.id));
      if (!again?.sequence || ids(again.sequence) !== ids(others) || (again.dropped ?? []).some((x) => !before.has(x.poi.id))) return null;
      base = again.sequence; complete = again.complete !== false;
    }
    r = tryBreakfastFirst({ sequence: base, stop: offered, day: d.day, home: d.home, legFn, rules, settings, country, kb, complete, giveWay });
  }
  if (!r.ok || r.displaced.length) return null;
  const now = new Map(seq.map((s) => [s.poi.id, s.startMin]));
  // 引擎填的站不算在「最多晚幾分」裡（釘住的日子除外——那裡它就是順序裡的一站）：填站是拿來填空檔的，早餐排進來它就往後挪、短一點（tryBreakfastFirst 的 giveWay），
  // 不是他原定的行程。不排除的話，早上被填站填滿的日子（第一站很晚才開、引擎填了早上的空檔）永遠掛不出推薦——11-12 太晚出門也觸發填站之後才會遇到
  const elastic = (s) => !d.pinned && s.insertedBy === 'engine' && s.priority === 'filler';
  const shiftMin = r.trial.slice(1).reduce((m, s) => (elastic(s) ? m : Math.max(m, s.startMin - (now.get(s.poi.id) ?? s.startMin))), 0);
  if (shiftMin > maxShift) return null;
  return { replaces: cur ? cur.poi.id : null, detourMin: r.detourMin, shiftMin };
}

/**
 * 一家店在 fromDate 之後的哪幾天排得成早餐（11-17）：breakfastFitDays({ poi, fromDate, days, legFn, rules, settings, country, kb, giveWay }) →
 * [{ date, replaces, detourMin, shiftMin }]（照日期）。每一天的合格條件跟 breakfastOffers 是同一個函式（breakfastFitOn），差別只有：不分紀錄是哪一種、每個合格的日子都列
 * （「吃飯店早餐」的推薦只掛在第一個合格的日子，這裡不停）。days 的形狀同 breakfastOffers；沒有 replanWithout 的日子（呼叫端不在 planTrip 裡）拿現在的序列試——
 * 那天的早餐是他勾的站自己落在早餐時段時，這個答案比引擎掛推薦時寬一點（引擎會真的少勾那一站重排一次再驗）。畫面用 engine/trip.js breakfastLaterDays，不用直接叫這個。
 */
export function breakfastFitDays({ poi, fromDate, days = [], legFn, rules, settings = {}, country = null, kb = null, giveWay = BREAKFAST_POLICY.giveWay }) {
  if (!poi?.id || !breakfastSlotOf(country, settings)) return [];
  const ctx = { legFn, rules, settings, country, kb, giveWay };
  const out = [];
  for (const d of [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!(d.date > fromDate)) continue;
    const fit = breakfastFitOn(poi, d, ctx);
    if (fit) out.push({ date: d.date, ...fit });
  }
  return out;
}

/**
 * 早餐那一站按「換一家」的清單（主控定的落地 C3、D3：只列能當早餐、那個時段有開、順路的店，店型不限；引擎排的早餐也能換）。
 * 回 [{ poi, detourMin, walkMin, shiftMin, open: true, meal: 'breakfast', mealNote }]——跟 engine/swap.js swapCandidates 的候選同一個形狀（多 walkMin、shiftMin），畫面用同一份清單畫。
 * 不用 swapCandidates 的原因：它拿「前一站→候選→後一站」算繞路，早餐是第一站、沒有前一站，算出來只剩「離下一站近」的店（七天包 8/13 只列得出一家）；
 * 早餐要從住宿算——這裡每一家都真的排成第一站試一次（tryBreakfastFirst），列出來的就是換了不會害別的站排不進的。
 * - plan、day、home：那天現在排好的 plan 與 day 上下文、住宿。現在的早餐是他勾的站自己落在早餐時段時，換掉之後其餘的站會重新搜尋（跟一般的「換一家」一樣），這裡拿現在的序列估。
 * - 不列：swapGated 的店（不是一個地點、研究判可略過、還沒解鎖、挖寶型）、這天行程裡已經有的站與同一處的另一筆、exclude 給的 id（畫面傳「任何一天勾過的＋任何一天序列裡的」，
 *   就不會列出換了會動到別天的店）、在場的人不想去的店型（跟現在這一站同店型的除外，同 swapCandidates）。
 * - 位置：離住宿走路 ≤ settings.breakfastWalkMaxMin 或比直接去第一站多繞 ≤ settings.onTheWayDetourMin（跟引擎挑早餐同一道門）。
 * - 排序：多繞的分鐘少的在前；一樣的研究首選在前、備案在後；再一樣營業固定的在前、照 pool 的順序。
 */
export function breakfastSwapCandidates({ plan, day, home, pool = [], legFn, rules, settings = {}, country = null, kb = null, exclude = [], giveWay = BREAKFAST_POLICY.giveWay }) {
  const cur = breakfastOfPlan(plan);
  if (!plan?.sequence || !breakfastSlotOf(country, settings)) return [];
  const rest = cur ? plan.sequence.filter((s) => s !== cur) : plan.sequence;
  const gone = new Set(exclude ?? []);
  const gonePois = pool.map((c) => c?.poi ?? c).filter((p) => p && gone.has(p.id));   // 同一處的另一筆也不列（他勾了仙台朝市商店街，就不列仙台朝市早餐）
  const near = { maxWalkMin: settings.breakfastWalkMaxMin ?? 12, maxDetourMin: settings.onTheWayDetourMin ?? 8 };
  const now = new Map(plan.sequence.map((s) => [s.poi.id, s.startMin]));
  const out = [];
  for (const c of pool) {
    const poi = c?.poi ?? c;
    if (!poi || !servesBreakfast(poi) || swapGated(poi) || gone.has(poi.id) || gonePois.some((g) => samePlace(g, poi)) || plan.sequence.some((s) => samePlace(s.poi, poi))) continue;
    if (cur && poi.category !== cur.poi.category && personAvoids(day?.adjust, poi)) continue;
    const stop = breakfastStop(poi, settings, { poiId: poi.id, priority: 'want' });
    // 釘住順序的日子（plan.pinned；engine/insert.js）：換了就是原位置換掉，照那個位置試（沒早餐就試第一站）；其餘的日子排成第一站試
    const r = plan.pinned
      ? tryBreakfastAt({ sequence: rest, index: cur ? plan.sequence.indexOf(cur) : 0, stop, day, home, legFn, rules, settings, country, kb, complete: plan.complete !== false, near })
      : tryBreakfastFirst({ sequence: rest, stop, day, home, legFn, rules, settings, country, kb, complete: plan.complete !== false, giveWay, near });
    if (!r.ok || r.displaced.length) continue;
    const shiftMin = r.trial.slice(1).reduce((m, s) => Math.max(m, s.startMin - (now.get(s.poi.id) ?? s.startMin)), 0);
    const note = servesMeal(poi, 'breakfast');
    out.push({ poi, detourMin: r.detourMin, walkMin: r.walkMin, shiftMin, open: true, meal: 'breakfast', mealNote: typeof note === 'string' ? note : null });
  }
  return out.map((o, i) => ({ o, i })).sort((x, y) => x.o.detourMin - y.o.detourMin || researchRank(x.o.poi) - researchRank(y.o.poi) || Number(closesIrregularly(x.o.poi)) - Number(closesIrregularly(y.o.poi)) || x.i - y.i).map(({ o }) => o);
}

// ── 旅程檔的動作（回新的 trip，不改傳入的）──

const withDay = (trip, date, fn) => ({ ...trip, days: (trip?.days ?? []).map((d) => (d.date === date ? fn(d) : d)) });
const stamp = (at) => (typeof at === 'string' && at ? at : new Date().toISOString());

/**
 * 「吃飯店早餐」（mode 'hotel'）／「改天去」（mode 'later'）：那天記 breakfast = { mode, poiId, at }——那天不排早餐、不提示；poiId 是原定那家（那天本來沒排到早餐就給 null）。
 * 原定那家是他勾的站（在那天的 picks 裡）就把那筆勾選拿掉、記在 breakfast.pick／pickIndex（「改回來」放回原位）；不記進 removed——不是「不去了」，那家留給後面的日子推薦。
 * 引擎排的早餐不在 picks 裡，不用拿。那天已經有紀錄就先改回來再記（換一種 mode、或換了原定那家）。mode 不認得、沒有那一天回原 trip。
 * 重排之後：早餐是引擎排的或他指定的那幾種，那天其餘各站的先後與時刻就是「沒有早餐」的樣子（早餐本來就是排完才安插的）；
 * 早餐是他勾的站自己落在早餐時段的，拿掉之後其餘的站會重新搜尋（跟按「不去了」一樣），先後可能變。
 */
export function setBreakfast(trip, date, mode, poiId = null, at = null) {
  if (!BREAKFAST_OFF_MODES.includes(mode) || !(trip?.days ?? []).some((d) => d.date === date)) return trip;
  return withDay(clearBreakfast(trip, date), date, (d) => {
    const id = typeof poiId === 'string' && poiId ? poiId : null;
    const picks = d.picks ?? [];
    const pickIndex = id ? picks.findIndex((p) => p?.poiId === id) : -1;
    const entry = { mode, poiId: id, at: stamp(at), ...(pickIndex >= 0 ? { pick: picks[pickIndex], pickIndex } : {}) };
    return { ...d, ...(pickIndex >= 0 ? { picks: picks.filter((_, i) => i !== pickIndex) } : {}), breakfast: entry };
  });
}

/**
 * 「改回來」：那天的 breakfast 紀錄拿掉，回到照常排早餐。當初拿掉的那筆勾選（breakfast.pick）放回原位——除非那家已經排到別天了（movedTo；再放回來同一家店會兩天都勾）
 * 或那天的 picks 裡又有它了。沒有紀錄回原 trip。
 */
export function clearBreakfast(trip, date) {
  const day = (trip?.days ?? []).find((d) => d.date === date);
  if (!day || day.breakfast == null) return trip;
  const b = breakfastChoiceOf(day);
  return withDay(trip, date, (d) => {
    const { breakfast: _gone, ...rest } = d;
    const picks = d.picks ?? [];
    if (!b?.pick || b.movedTo || picks.some((p) => p?.poiId === b.pick.poiId)) return rest;
    // 那家這段期間已經被勾進別天了（別天的「換一家」選了它）：不放回來，不然同一家店兩天都勾（11-12 審查；按「或 X」那條路靠 movedTo 擋，這裡擋其餘的路）
    if ((trip.days ?? []).some((x) => x.date !== date && (x.picks ?? []).some((p) => p?.poiId === b.pick.poiId))) return rest;
    const next = [...picks];
    next.splice(Math.min(b.pickIndex ?? next.length, next.length), 0, b.pick);
    return { ...rest, picks: next };
  });
}

/**
 * 把 toPoiId 定成那天的早餐（共用的那一步；plan＝那天現在排好的 plan，拿它知道現在的早餐是哪一站）：
 * - 現在的早餐是他勾的站（自己落在早餐時段的、或他之前指定的）：那筆勾選換成 toPoiId、標 breakfast: true，換掉的記進 swapped（不算落選；原話 #91）；
 *   原本那筆寫的停留是給舊那家的，不沿用。現在的早餐是他必去／指定／主行程／固定時段的站就不換，另加一筆。
 * - 現在的早餐是引擎排的、或那天沒有早餐：加一筆 { poiId, priority 'want', breakfast: true }——引擎那天不再另挑。
 * - toPoiId 本來就在那天的 picks 裡：那一筆標成早餐，不重複加。
 * 換掉的那一家（不管是他勾的還是引擎排的）記進 swapped，帶 breakfast: true：引擎之後整趟都不再主動拿它當早餐（blockedBreakfasts）——
 * 不擋的話它被放出來，別天的早餐會自己換成它（11-11 實跑：七天包 8/13 的早餐換一家，8/16 的早餐就從 Cafe de 埃比昂 變成 立ちそば処 杜）；他只動了這一天，別天不該跟著變。
 */
function putBreakfast(trip, date, toPoiId, plan, at) {
  return withDay(trip, date, (d) => {
    const picks = d.picks ?? [];
    const curId = plan?.meals?.breakfast ?? null;
    const cur = curId ? (plan?.sequence ?? []).find((s) => s.poi.id === curId) : null;
    const locked = Boolean(cur) && (cur.priority === 'must' || cur.designated || cur.isAnchor || Boolean(cur.fixedWindow));
    const replaced = Boolean(cur) && !locked && curId !== toPoiId;
    const mine = replaced && !cur.insertedBy ? picks.findIndex((p) => p?.poiId === curId) : -1;
    const own = picks.findIndex((p) => p?.poiId === toPoiId);
    let next;
    if (own >= 0) next = picks.filter((_, i) => i !== mine).map((p) => (p?.poiId === toPoiId ? { ...p, breakfast: true } : p));
    else if (mine >= 0) next = picks.map((p, i) => { if (i !== mine) return p; const { dwellMin: _dwell, ...keep } = p; return { ...keep, poiId: toPoiId, breakfast: true }; });
    else next = [...picks, { poiId: toPoiId, priority: 'want', breakfast: true }];
    // 一天只有一筆指定的早餐：別筆的標記拿掉（留著當一般的站）
    next = next.map((p) => (p?.breakfast === true && p.poiId !== toPoiId ? (({ breakfast: _flag, ...keep }) => keep)(p) : p));
    const swapped = replaced ? [...(d.swapped ?? []), { from: curId, to: toPoiId, at: stamp(at), breakfast: true }] : d.swapped;
    // 釘住順序的日子（days[].pinned；engine/insert.js）：新的那一家放在被換掉那一站的原位置；沒有換掉誰（那天沒早餐、現在的早餐是鎖住的站）就排在第一站
    const pinned = pinnedWithBreakfast(d.pinned, replaced ? curId : null, toPoiId, own >= 0);
    return { ...d, picks: next, ...(swapped ? { swapped } : {}), ...(pinned ? { pinned } : {}) };
  });
}

/**
 * 釘住的順序裡把早餐換成 toId。那天沒釘住回 null。
 * - toId 本來就是那天勾的站、也在順序裡（改標成早餐）：留在原位，被換掉的那一筆（fromId）拿掉。
 * - 不然：頂替 fromId 的位置（停留不沿用，那是舊那家的）；沒有 fromId、或 fromId 不在順序裡，就放第一筆。順序裡殘留的 toId 舊筆先拿掉。
 */
function pinnedWithBreakfast(pinned, fromId, toId, alreadyPicked) {
  if (!pinned || typeof pinned !== 'object' || Array.isArray(pinned) || !Array.isArray(pinned.sequence)) return null;
  const seq = pinned.sequence.filter((e) => e && typeof e === 'object');
  if (alreadyPicked && seq.some((e) => e.poiId === toId)) return { ...pinned, sequence: fromId ? seq.filter((e) => e.poiId !== fromId) : seq };
  const rest = seq.filter((e) => e.poiId !== toId);
  if (fromId && rest.some((e) => e.poiId === fromId)) return { ...pinned, sequence: rest.map((e) => (e.poiId === fromId ? { poiId: toId } : e)) };
  return { ...pinned, sequence: [{ poiId: toId }, ...rest] };
}

/**
 * 早餐那一站按「換一家」選了 toPoiId（引擎排的早餐也能換，換了就變成他勾的；主控定的落地 D3）。plan＝那天現在排好的 plan。沒有那一天、沒給店回原 trip。
 * 候選清單用 breakfastSwapCandidates。重排之後 toPoiId 排成那天的第一站；原本的早餐是引擎排的或他指定的，其餘各站先後不變。
 */
export function swapBreakfast(trip, date, toPoiId, plan, at = null) {
  if (typeof toPoiId !== 'string' || !toPoiId || !(trip?.days ?? []).some((d) => d.date === date)) return trip;
  // 換進來的那家是別天記著沒去到的那一家（他在那天按過「吃飯店早餐」「改天去」）：那筆紀錄標成排到這天了（movedTo），跟按「或 X」同一個處理——
  // 不標的話，那天再按「改回來」會把勾選放回去，同一家店兩天都有（11-12 審查）
  const moved = { ...trip, days: trip.days.map((d) => (d.date !== date && d.breakfast && typeof d.breakfast === 'object' && d.breakfast.poiId === toPoiId && !d.breakfast.movedTo ? { ...d, breakfast: { ...d.breakfast, movedTo: date } } : d)) };
  return putBreakfast(moved, date, toPoiId, plan, at);
}

/**
 * 按了早餐卡上的「或 X（8/13 沒去的）」：X 變成那天的早餐（putBreakfast），原本記著它的那天（推薦的 fromDate）標 movedTo＝這天——它排走了，不再推薦。
 * plan＝那天現在排好的 plan（要有 breakfastOffers；找不到這家的推薦就回原 trip，不亂動）。重排之後那天其餘各站的先後不變（推薦掛出來之前就驗過）。
 */
export function takeBreakfastOffer(trip, date, poiId, plan, at = null) {
  const offer = (plan?.breakfastOffers ?? []).find((o) => o.poiId === poiId);
  if (!offer || !(trip?.days ?? []).some((d) => d.date === date)) return trip;
  const moved = withDay(trip, offer.fromDate, (d) => (d.breakfast && typeof d.breakfast === 'object' && d.breakfast.poiId === poiId ? { ...d, breakfast: { ...d.breakfast, movedTo: date } } : d));
  return putBreakfast(moved, date, poiId, plan, at);
}

/** 還記著、等著推薦的那幾家：[{ fromDate, mode, poiId }]（旅程檔每天的 breakfast 裡有原定那家、還沒排走的）。 */
export function rememberedBreakfasts(trip) {
  const out = [];
  for (const d of trip?.days ?? []) {
    const b = breakfastChoiceOf(d);
    if (b?.poiId && !b.movedTo) out.push({ fromDate: d.date, mode: b.mode, poiId: b.poiId });
  }
  return out;
}

/** 他換掉過的早餐（任何一天 swapped 裡帶 breakfast: true 的 from）：引擎整趟不再主動拿去當早餐。回 poi id 陣列。他自己勾、換一家清單、推薦都不受影響。 */
export function blockedBreakfasts(trip) {
  return [...new Set((trip?.days ?? []).flatMap((d) => (d.swapped ?? []).filter((x) => x?.breakfast === true && typeof x.from === 'string' && x.from).map((x) => x.from)))];
}

/** 旅程檔每天記著的「上一版引擎替這天挑的早餐」（days[].engineBreakfast）→ Map<date, poi id>；沒記、寫壞（不是字串）的日子不在裡面。assignBreakfasts 的 keep 吃這個。 */
export function breakfastKeepOf(trip) {
  const out = new Map();
  for (const d of trip?.days ?? []) if (typeof d?.engineBreakfast === 'string' && d.engineBreakfast) out.set(d.date, d.engineBreakfast);
  return out;
}

/**
 * 整趟重排之後（ui/app.js 每次 planTrip 完呼叫，跟 engine/insert.js repinTrip 同一個時機），把每天引擎排的早餐記回旅程檔：keepBreakfasts(trip, days) → 新 trip；
 * 沒有東西要改就回原 trip（同一個物件，呼叫端拿它判要不要存檔）。days＝planTrip 回的 days（[{ date, plan }]；沒排的日子 plan 是 null，那天記著的不動）。
 * 記的是序列裡引擎排的那一站早餐（insertedBy 'engine'、priority 'breakfast'；釘住的日子記在順序裡的也算）；那天沒有（他勾的站當早餐、他指定了、他說不排、排不進）就把那一欄拿掉。
 * 下一次重排 planTrip 讀它（breakfastKeepOf）交給 assignBreakfasts 沿用：別天的早餐不會因為他動了某一天就換店。
 * 那天他按「吃飯店早餐」再按「改回來」拿回同一家，不靠這一欄：別天都沿用著，那天從剩下的店裡挑最好的，就是原本那一家（原本的分法扣掉別天，是剩下那一題的最好分法）。
 */
export function keepBreakfasts(trip, days = []) {
  const now = new Map();
  for (const x of days ?? []) {
    if (!x?.plan) continue;
    const s = (x.plan.sequence ?? []).find((q) => q?.insertedBy === 'engine' && q.priority === BREAKFAST_PRIORITY);
    now.set(x.date, s ? s.poi.id : null);
  }
  let changed = false;
  const next = (trip?.days ?? []).map((d) => {
    if (!now.has(d.date)) return d;
    const id = now.get(d.date);
    if (id ? d.engineBreakfast === id : !('engineBreakfast' in d)) return d;
    changed = true;
    if (id) return { ...d, engineBreakfast: id };
    const { engineBreakfast: _gone, ...rest } = d;
    return rest;
  });
  return changed ? { ...trip, days: next } : trip;
}

export { breakfastOffOf, breakfastSlotOf };
