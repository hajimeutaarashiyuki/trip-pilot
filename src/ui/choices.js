// 二選一與順延的畫面邏輯（T16；DESIGN §6.3.2；profile §7、總則 6；原話 #119、#121、#138）：純函式（可測，不碰 DOM）；寫回 state 在 app.js，畫在 planner.js（站卡「或 B」、排不進清單「排到別天」、「從 8/15 順延」）與 pool.js（「順延中」）。
// 選了 B＝換這一站的邏輯把 A 換成 B（engine/swap.js applySwap，priority 沿用）＋ A 順延到別天（engine/choices.js defer）；沒按＝照引擎（A 留著、B 不順延）。
import { applySwap } from '../engine/swap.js';
import { defer, deferredEntry } from '../engine/choices.js';
import { TEXT } from './text.js';
import { dateLabel } from './dom.js';

/** 這站的二選一（plan.choices 裡 poiId 是它的那筆），沒有回 null。 */
export function choiceOf(plan, poiId) {
  return plan?.choices?.find((c) => c.poiId === poiId) ?? null;
}

/**
 * 選了 B：那天的 picks 把 A 換成 B（priority 沿用；記 day.swapped，換掉的不算落選）、A 順延到別天；回 { trip, entry, toDate }，不改傳入的 trip。
 * B 不在 pois 裡（候選池來的）就一起帶進去給 defer 試排用；呼叫端（app.js）另外把它加進 state.pois。
 */
export function chooseOptionTrip({ trip, pois, date, fromPoiId, toPoi, baseline, planArgs }) {
  // A 的優先度先記下來：換站後 A 不在這天的 picks 裡了，順延要沿用它（maybe 搬走還是 maybe）
  const priority = trip.days.find((d) => d.date === date)?.picks?.find((p) => p.poiId === fromPoiId)?.priority ?? 'want';
  const swapped = { ...trip, days: trip.days.map((d) => (d.date === date ? swapPick(d, fromPoiId, toPoi) : d)) };
  const allPois = pois[toPoi.id] ? pois : { ...pois, [toPoi.id]: toPoi };
  return defer({ trip: swapped, pois: allPois, poiId: fromPoiId, fromDate: date, chosenPoiId: toPoi.id, baseline, planArgs, priority });
}

const PRIORITY_RANK = Object.freeze({ must: 3, want: 2, maybe: 1 });
/** 兩個優先度取高的（must > want > maybe；不認得的算最低）。 */
const higherPriority = (x, y) => ((PRIORITY_RANK[x] ?? 0) >= (PRIORITY_RANK[y] ?? 0) ? x : y);

/**
 * 那天的 picks 把 A 換成 B（applySwap：priority 沿用 A 的、記 day.swapped）。B 本來就是今天的勾選（來源是「今天排不進的同類勾選站」）就不重複：
 * A 的那筆拿掉、B 自己那筆留著（停留照它自己的）、優先度取 A 與 B 自己之間高的（他選了它頂 A 的位置，至少要有 A 的分量；B 本來就比 A 高就不降——10-16 審查：A maybe、B want 時之前會降成 maybe）。
 * 回新的 day，不改傳入的。
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
export function deferNotice(entry, name, displaced = []) {
  const base = entry?.toDate ? TEXT.deferredTo(name, dateLabel(entry.toDate)) : TEXT.deferredUnplaced(name);
  if (!displaced.length) return base;
  return `${base}；${TEXT.displacedNote(displaced.map((x) => TEXT.displacedOne(dateLabel(x.date), x.poi?.name_zh ?? x.poiId)).join('、'))}`;
}

/**
 * 二選一／排到別天之後的整趟重排擠掉了哪些勾選站：那幾天（fromDate 與 toDate）重排前不在排不進清單、重排後在的（他勾的站；引擎插的排不進不算落選、不進 dropped）。
 * before／after 是 state.plans 那種 { [date]: { plan } }。回 [{ date, poi }]（照 dates 的順序）。選的 B 自己排不進也會列（「換一家」一樣不保證 B 排得進）。
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
