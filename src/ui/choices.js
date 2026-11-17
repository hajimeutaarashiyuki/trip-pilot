// 二選一與順延的畫面邏輯（T16；DESIGN §6.3.2；profile §7、總則 6；原話 #119、#121、#138）：純函式（可測，不碰 DOM）；寫回 state 在 app.js，畫在 planner.js（站卡「或 B」、排不進清單「排到別天」、「從 8/15 順延」）與 pool.js（「順延中」）。
// 選了 B＝那一天把 A 換成 B（engine/choices.js chooseDay：換這一站的邏輯、priority 沿用；釘住順序的日子 B 寫進 A 的原位置）＋ A 順延到別天（engine/choices.js defer）；沒按＝照引擎（A 留著、B 不順延）。
// 釘住順序的日子（安插之後；原話 #192）畫「或 B」之前先試排（dayChoices → engine/choices.js choicesFor）：選了會讓其餘各站少掉、換位置或多掉進排不進的不出，比照那天的換一家清單。
import { applySwap } from '../engine/swap.js';
import { defer, deferredEntry, chooseDay, choicesFor } from '../engine/choices.js';
import { planArgsOf } from './plan-args.js';
import { TEXT } from './text.js';
import { dateLabel } from './dom.js';

/**
 * 這天畫面上可以出的二選一（state.plans[date].plan.choices 的子集；那天沒排回空陣列）：沒釘住的日子＝引擎給的原樣（同一個陣列）；
 * 釘住順序的日子只留選了沒事的——每一個真的選下去排那一天一次（engine/choices.js choicesFor／pinnedChoiceCheck，每個約 1.3 ms），
 * B 在 A 的原位置、原本每一站都在而且先後不變、沒有站多掉進排不進才留。規劃頁每天畫之前叫一次（planner.js dayBlock）。
 * 11-17 引擎段在六個打包檔上量：279 個釘住的情境、254 個「或 B」裡選了出事的 1 個（10-27 舊七天包 8/17「星山珈琲店 或 darestore」）。
 */
export function dayChoices(state, date) {
  const plan = state?.plans?.[date]?.plan;
  if (!plan) return [];
  return choicesFor({ trip: state.trip, date, plan, pois: state.pois ?? {}, planArgs: planArgsOf(state) });
}

/** 這站的二選一（choices＝dayChoices 回的那一份；裡面 poiId 是它的那筆），沒有回 null。 */
export function choiceOf(choices, poiId) {
  return (Array.isArray(choices) ? choices : []).find((c) => c.poiId === poiId) ?? null;
}

/**
 * 選了 B：那天把 A 換成 B（engine/choices.js chooseDay——picks 裡 A 的那筆換成 B、priority 沿用，B 本來就是今天的勾選就留它自己那筆、優先度取高的；記 day.swapped，換掉的不算落選；
 * 釘住順序的日子順序裡 A 的那一筆原位置換成 B）、A 順延到別天；回 { trip, entry, toDate }，不改傳入的 trip。
 * 11-17 起那一天怎麼改走引擎的 chooseDay（之前是這一檔自己的 swapPick，不改釘住的順序、靠重排時順著換站紀錄推回原位置）：畫「或 B」之前的試排用的就是它，
 * 試排與真的套用走同一個函式，試出來沒事按下去才真的沒事。沒釘住的日子兩者結果相同。
 * B 不在 pois 裡（候選池來的）就一起帶進去給 defer 試排用；呼叫端（app.js）另外把它加進 state.pois。
 */
export function chooseOptionTrip({ trip, pois, date, fromPoiId, toPoi, baseline, planArgs }) {
  // A 的優先度先記下來：換站後 A 不在這天的 picks 裡了，順延要沿用它（maybe 搬走還是 maybe）
  const priority = trip.days.find((d) => d.date === date)?.picks?.find((p) => p.poiId === fromPoiId)?.priority ?? 'want';
  const swapped = { ...trip, days: trip.days.map((d) => (d.date === date ? chooseDay(d, fromPoiId, toPoi) : d)) };
  const allPois = pois[toPoi.id] ? pois : { ...pois, [toPoi.id]: toPoi };
  return defer({ trip: swapped, pois: allPois, poiId: fromPoiId, fromDate: date, chosenPoiId: toPoi.id, baseline, planArgs, priority });
}

const PRIORITY_RANK = Object.freeze({ must: 3, want: 2, maybe: 1 });
/** 兩個優先度取高的（must > want > maybe；不認得的算最低）。 */
const higherPriority = (x, y) => ((PRIORITY_RANK[x] ?? 0) >= (PRIORITY_RANK[y] ?? 0) ? x : y);

/**
 * 11-17 之前選了 B 那一天的改法（畫面已經不用：chooseOptionTrip 改走 engine/choices.js chooseDay）。只留給 test/engine/insert.test.js 當對照——
 * 那邊逐欄比新舊兩種做法改出來的 picks、swapped 與排出來的序列相同；那段對照拿掉之後這個函式就可以刪。沒有別的程式用它，建置時會被搖掉、不進單檔。
 * 做法：那天的 picks 把 A 換成 B（applySwap：priority 沿用 A 的、記 day.swapped）。B 本來就是今天的勾選（來源是「今天排不進的同類勾選站」）就不重複：
 * A 的那筆拿掉、B 自己那筆留著（停留照它自己的）、優先度取 A 與 B 自己之間高的。不改釘住的順序（pinned）——跟 chooseDay 差在這裡。回新的 day，不改傳入的。
 */
export function swapPick(day, fromPoiId, toPoi) {
  const own = (day.picks ?? []).find((p) => p.poiId === toPoi.id);
  if (!own) return applySwap(day, fromPoiId, toPoi);
  const a = (day.picks ?? []).find((p) => p.poiId === fromPoiId);
  const picks = (day.picks ?? []).filter((p) => p.poiId !== fromPoiId).map((p) => (p === own ? { ...own, priority: higherPriority(a?.priority, own.priority) ?? 'want' } : p));
  return { ...day, picks, swapped: [...(day.swapped ?? []), { from: fromPoiId, to: toPoi.id, at: new Date().toISOString() }] };
}

/** 排不進清單的「排到別天」：直接順延（沒有選的那家，chosenPoiId null）。 */
export function deferStopTrip({ trip, pois, date, poiId, baseline, planArgs }) {
  return defer({ trip, pois, poiId, fromDate: date, chosenPoiId: null, baseline, planArgs });
}

/**
 * 順延後復原列那句（app.js 放在 state.undo.text，跟「復原」鍵同一列；原話 #181）：排到了「A 已排到 8/17（一）」、排不進「A 先留在候選池（別天排不進）」；重排擠掉了別的勾選站（displacedPicks）就接一句「擠掉了 8/13（四） 的 X、…」
 * （10-16 審查：8/13 選候選池的 FLAT WHITE 頂掉 Elbe，整天重排後他沒碰的珈巣多夢落到排不進清單，之前那句只寫 Elbe 排到哪）。
 */
export function deferNotice(entry, name, displaced = [], chosenUnplaced = null) {
  const parts = [entry?.toDate ? TEXT.deferredTo(name, dateLabel(entry.toDate)) : TEXT.deferredUnplaced(name)];
  // chosenUnplaced＝二選一選的那一家（B）的店名，重排之後它自己還是排不進時才給：寫「B 今天排不進」，不混進「擠掉了…」（呼叫端把 B 從 displaced 拿掉；11-17）
  if (chosenUnplaced) parts.push(TEXT.chosenUnplaced(chosenUnplaced));
  if (displaced.length) parts.push(TEXT.displacedNote(displaced.map((x) => TEXT.displacedOne(dateLabel(x.date), x.poi?.name_zh ?? x.poiId)).join('、')));
  return parts.join('；');
}

/**
 * 二選一／排到別天之後的整趟重排擠掉了哪些勾選站：那幾天（fromDate 與 toDate）重排前不在排不進清單、重排後在的（他勾的站；引擎插的排不進不算落選、不進 dropped）。
 * before／after 是 state.plans 那種 { [date]: { plan } }。回 [{ date, poi }]（照 dates 的順序）。選的 B 自己排不進也會列——呼叫端（app.js chooseOption、swapStop）把它挑出來另外講
 * （「B 今天排不進」），不寫成被擠掉的。11-17 起引擎搜尋時會讓他當場選的那一家先排（engine/core.js chosenPullOf），B 排不進只剩今天沒開、撞到必去或主行程這幾種。
 */
export function displacedPicks({ before = {}, after = {}, dates = [] }) {
  const out = [];
  for (const date of dates) {
    if (!date) continue;
    const was = new Set((before?.[date]?.plan?.dropped ?? []).map((x) => x.poi.id));
    for (const x of after?.[date]?.plan?.dropped ?? []) if (!was.has(x.poi.id)) out.push({ date, poi: x.poi });
  }
  return out;
}

/**
 * 候選頁那行尾巴的順延標記：unplaced 的寫「順延中：別天排得進再排」；placed 但順延到的那天重排後排不進（plans[toDate].plan.dropped 有它；整趟警告 deferred-dropped 的情況，App 沒畫整趟警告）也寫這句；
 * placed 又排進去的由序列標「已排 X」照既有，這裡回 null。
 */
export function deferredMark(trip, poiId, plans = {}) {
  const e = deferredEntry(trip, poiId);
  if (!e) return null;
  if (e.status === 'unplaced') return TEXT.deferredPending;
  if (e.status === 'placed' && e.toDate && (plans?.[e.toDate]?.plan?.dropped ?? []).some((x) => x.poi.id === poiId)) return TEXT.deferredPending;
  return null;
}
