// 二選一與順延的畫面邏輯（T16；DESIGN §6.3.2；profile §7、總則 6；原話 #119、#121、#138）：純函式（可測，不碰 DOM）；寫回 state 在 app.js，畫在 planner.js（站卡「或 B」、排不進清單「排到別天」、「從 8/15 順延」）與 pool.js（「順延中」）。
// 選了 B＝那一天把 A 原位置換成 B、那天照畫面上這一版釘住（engine/choices.js swapInPlace；11-24 起不分釘不釘住）＋ A 順延到別天（engine/choices.js defer）；沒按＝照引擎（A 留著、B 不順延）。
// 畫「或 B」之前先試排（dayChoices → engine/choices.js choicesFor）：選了會讓其餘各站少掉、換位置或多掉進排不進的不出，比照那天的換一家清單。
import { defer, deferredEntry, swapInPlace, choicesFor } from '../engine/choices.js';
import { planArgsOf } from './plan-args.js';
import { TEXT } from './text.js';
import { dateLabel } from './dom.js';

/** 每天試排過的那一份二選一：規劃頁每畫一次就每天問一次，同一份 plan 只試一次（重排之後 plan 是新物件；旅程檔或知識庫換了也重算）。 */
const shown = new WeakMap();

/**
 * 這天畫面上可以出的二選一（state.plans[date].plan.choices 的子集；那天沒排回空陣列）：只留選了沒事的——每一個真的選下去排那一天一次
 * （engine/choices.js choicesFor／pinnedChoiceCheck），B 在 A 的原位置、原本每一站都在而且先後不變、沒有站多掉進排不進才留。規劃頁每天畫之前叫一次（planner.js dayBlock）。
 * 11-17 起釘住的日子這樣做，11-24 起沒釘住的日子也是（選了 B 一律原位置換掉、把那天釘住）。
 */
export function dayChoices(state, date) {
  const plan = state?.plans?.[date]?.plan;
  if (!plan) return [];
  const hit = shown.get(plan);
  if (hit && hit.trip === state.trip && hit.pois === state.pois) return hit.list;
  const list = choicesFor({ trip: state.trip, date, plan, pois: state.pois ?? {}, planArgs: planArgsOf(state) });
  shown.set(plan, { trip: state.trip, pois: state.pois, list });
  return list;
}

/** 這站的二選一（choices＝dayChoices 回的那一份；裡面 poiId 是它的那筆），沒有回 null。 */
export function choiceOf(choices, poiId) {
  return (Array.isArray(choices) ? choices : []).find((c) => c.poiId === poiId) ?? null;
}

/**
 * 選了 B：那天把 A 原位置換成 B（engine/choices.js swapInPlace——還沒釘住的日子先照畫面上這一版釘住；picks 裡 A 的那筆換成 B、priority 沿用，B 本來就是今天的勾選就留它自己那筆、
 * 優先度取高的；記 day.swapped，換掉的不算落選；釘住的順序裡 A 的那一筆原位置換成 B）、A 順延到別天；回 { trip, entry, toDate }，不改傳入的 trip。
 * 畫「或 B」之前的試排（dayChoices）用的是同一個 swapInPlace：試排與真的套用走同一個函式，試出來沒事按下去才真的沒事。
 * 釘住要有那天畫面上的 plan：從 baseline（當下的 planTrip 結果）拿；baseline 沒有那一天就不釘、只改勾選（測試直接叫這個函式時）。
 * B 不在 pois 裡（候選池來的）就一起帶進去給 defer 試排用；呼叫端（app.js）另外把它加進 state.pois。
 */
export function chooseOptionTrip({ trip, pois, date, fromPoiId, toPoi, baseline, planArgs }) {
  // A 的優先度先記下來：換站後 A 不在這天的 picks 裡了，順延要沿用它（maybe 搬走還是 maybe）
  const priority = trip.days.find((d) => d.date === date)?.picks?.find((p) => p.poiId === fromPoiId)?.priority ?? 'want';
  const allPois = pois[toPoi.id] ? pois : { ...pois, [toPoi.id]: toPoi };
  const plan = (baseline?.days ?? []).find((x) => x?.date === date)?.plan ?? null;
  const swapped = swapInPlace({ trip, date, fromPoiId, toPoi, plan, pois: allPois });
  return defer({ trip: swapped, pois: allPois, poiId: fromPoiId, fromDate: date, chosenPoiId: toPoi.id, baseline, planArgs, priority });
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
 * （「B 今天排不進」），不寫成被擠掉的。11-24 起換一家與「或 B」都先試排過才列、選了原位置換掉，從清單與卡上選的不會有這兩種事；
 * 留著是給不經過清單直接叫動作的情況（B 今天沒開、原位置排不進）照實講。
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
 * 整天重新搜尋之後他勾的站掉進排不進清單（displacedPicks 的結果），而且沒有誰擠它——「不去了」「讓引擎重排這天」之後那天交給引擎重排、排不進的：
 * 接在復原列後面的「；X、Y 排不進了」，沒有回空字串。short＝店名怎麼縮短（app.js 給 corridor.js 的 shortName；不給就用全名）。
 * 換一家、「或 B」、排到別天那種「選進來的擠掉別站」用的是另一句「擠掉了 8/13（四） 的 X」（deferNotice、app.js squeezedNote）。
 * 「不去了」11-25 才接上這一句：文件的對抗審查在三包每一張有「不去了」的站卡各按一次，102 次裡 8 次同一天他勾的另一站掉進排不進，復原列之前一個字都沒提。
 */
export function fellNote(list = [], short = (name) => name) {
  return list.length ? `；${TEXT.otherDays.dropped(list.map((x) => short(x.poi.name_zh ?? x.poi.id)).join('、'))}` : '';
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
