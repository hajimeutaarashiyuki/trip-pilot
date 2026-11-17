// 規劃頁：看整趟、改不順眼的（總則 6）。每天一塊：日期與主行程、整天的黃字（今天沒排午餐那種，在日期下方；原話 #174）、勉強幾分、留白、站卡（時間、名字、走幾分、幾點關、一句話、那站的黃字）、換一家（每家附簡介；原話 #177）、不去了、排不進的。
// 打開規劃頁會捲到當天那一塊（原話 #175；app.js render 用 section.day 的 data-date 找）。
// 11-06 第二批：走廊清單「升級成站」＝安插（排不下在那一家底下展開一組選項；原話 #192–#194）、釘住順序的日子日期下面一行小字＋「讓引擎重排這天」、
// 換一家清單最上面講在換哪一餐（原話 #195）、早餐那一站的卡與鍵（改天去、吃飯店早餐、或 X；原話 #196、#197）。
import { el, hm, dateLabel, monthDay } from './dom.js';
import { TEXT, CATEGORY, introOf } from './text.js';
import { openIntervals } from '../engine/time.js';
import { resolveHome } from '../engine/trip.js';
import { placeUrl, routeUrl, coordQuery, legMode, tripCityName } from './maps.js';
import { darkBeforeMinOf } from './daylight.js';
import { corridorOfLeg, legSuggestOf, corridorNames, corridorListNode, corridorDisclosure } from './corridor.js';
import { choiceOf } from './choices.js';
import { askView } from './insert.js';
import { breakfastCardOf, swapListOf, offersOn, looseOffers, breakfastOffText } from './meals.js';

export function renderPlanner({ state, actions }) {
  const nodes = [el('h1', { text: state.trip.name ?? TEXT.appName })];
  // 剛按過「不去了」「換一家」「升級成站」「讓引擎重排這天」「或 B」「排到別天」、早餐的鍵：給一次反悔的機會（原話 #171；二選一與排到別天也做，原話 #181），下一個動作前都在；
  // 列是 sticky 的，在長頁深處按了也看得到。那一句由 app.js 算好放在 undo.text（升級成站：插在誰跟誰之間、後面順延幾分；別天跟著變了也接在後面）
  if (state.undo) nodes.push(undoBar(state.undo.text, actions));
  // 不是動作的一句狀態（「旅程更新過了，上一版的改動已丟掉」「正在重排…」「正在試排…」）：同一種 sticky 列、不搶復原列
  if (state.notice) nodes.push(el('div', { class: 'undo-bar notice' }, [el('span', { text: state.notice.text }), el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.dismissNotice() }, TEXT.noticeClose)]));
  for (const d of state.trip.days) {
    const planned = state.plans[d.date];
    if (!planned) continue;
    nodes.push(dayBlock(d, planned, state, actions));
  }
  return nodes;
}

/**
 * 復原列（規劃頁與現場頁共用）：那一句、「復原」、「關閉」。「關閉」只是把這一列收掉、不復原——列是貼在視窗頂端的，安插之後那一句在手機上有好幾行高，
 * 之前只有「復原」一顆鍵，不想復原也得等下一個動作它才消失（11-12 畫面審查）。
 * 兩顆鍵怎麼排看那一句有多長（undoBarStacked）：短的並排、長的疊成一欄。11-12 在 390px 寬實量六句（px；之前只有「復原」／兩顆並排／兩顆疊成一欄，鍵距 6px 量的）：
 * 不去了 60／60／105、安插 60／81／105、換一家 81／102／105、不去了＋別天一處 81／102／105、讓引擎重排＋別天三天 144／165／144、安插三輪 144／207／144——
 * 並排時文字欄只剩 198px，句子長就多好幾行；疊成一欄文字欄不變，但整列最矮也要 105px。所以四行以內的句子並排、更長的疊起來（六句合計 633，只有「復原」時 570、一律並排 717、一律疊 708）。
 */
export function undoBar(text, actions) {
  return el('div', { class: 'undo-bar' }, [
    el('span', { text }),
    el('span', { class: undoBarStacked(text) ? 'keys stack' : 'keys' }, [
      el('button', { class: 'btn', type: 'button', onclick: () => actions.undoLast() }, TEXT.undo),
      el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.dismissUndo() }, TEXT.undoClose),
    ]),
  ]);
}

/**
 * 復原列那一句夠長（兩顆鍵要疊成一欄）嗎：照字寬估——中日文全形字算 1、其餘（英數、半形標點、空白）算 0.55，合計超過 UNDO_STACK_FROM 就疊。
 * 55＝並排時文字欄（390px 寬的手機上約 194px、一行不到 14 個全形字）排得下四行的量：四行以內並排（102px）不比疊起來（最矮 109px）高，五行起是疊起來矮。
 */
const UNDO_STACK_FROM = 55;
export function undoBarStacked(text) {
  let width = 0;
  for (const ch of String(text ?? '')) width += ch.codePointAt(0) > 0x2E7F ? 1 : 0.55;
  return width > UNDO_STACK_FROM;
}

function dayBlock(d, planned, state, actions) {
  const { plan, day } = planned;
  const anchorLine = day.themeCategory ? `${TEXT.themeOf(day.themeCategory)}，${TEXT.anchorOf(day.anchorName)}` : TEXT.anchorOf(day.anchorName);
  // 整天的黃字（今天沒排午餐、沒夜間站、必去缺席、步行超預算……）：沒有 poiId 的那些；長段提示（leg-suggest）畫在那一段的移動行上（legBlock），不進這份
  const dayWarnings = plan.warnings.filter((w) => !w.poiId && w.code !== 'skipped-missing' && w.ruleId !== 'leg-suggest');
  const small = (label, onclick) => el('button', { class: 'btn quiet sm', type: 'button', onclick }, label);
  const offText = breakfastOffText(day, state.pois, d);   // d＝旅程檔那一天：原定那家是他勾的站時把店名寫出來
  // data-date：打開規劃頁要捲到當天那一塊（原話 #175；app.js render）
  const block = el('section', { class: 'day', 'data-date': d.date }, [
    el('header', { class: 'day-head' }, [el('h2', { text: dateLabel(d.date) }), el('p', { class: 'muted', text: anchorLine })]),
    // 整天的黃字畫在日期與主行程那行下方、「這天有 N 分鐘的勉強」之前（原話 #174「提醒事項 像是當天沒有午餐 應該放在日期的下方」）；之前接在所有站卡後面，要滑到底才看得到。每站自己的黃字照舊在站卡上。
    // 「今天沒排早餐」是提示樣式、不是黃字（他本來就可能吃飯店；原話 #196），旁邊一顆小鍵「吃飯店早餐」：按了那天就不提示（推導：引擎排不進早餐的日子沒有早餐卡可以按）
    dayWarnings.length ? warnList(dayWarnings, (w) => (w.ruleId === 'breakfast-slot' ? small(TEXT.breakfast.hotel, () => actions.breakfastOff(d.date, 'hotel')) : null)) : null,
    // 釘住順序的日子（升級成站安插之後；主控定的落地 A2）：這天照他調過的順序排，不去了／換一家／早餐的鍵都在這條順序上做；小鍵解除、交回引擎整天重排
    plan.pinned ? el('p', { class: 'muted small day-note' }, [TEXT.pinnedNote, small(TEXT.unpin, () => actions.unpinDay(d.date))]) : null,
    // 他說這天不排早餐（吃飯店早餐／改天去；原話 #196）：一行小字＋「改回來」
    offText ? el('p', { class: 'muted small day-note' }, [offText, small(TEXT.breakfast.back, () => actions.breakfastBack(d.date))]) : null,
    // 這天沒有早餐站、卻有他之前沒去到的那家可以排（原話 #197）：一行＋「排進這天」，下面附那家的說明與簡介；他按了才排
    ...looseOffers(plan, state.pois).map((x) => el('p', { class: 'muted small day-note' }, [
      TEXT.breakfast.offerLoose(monthDay(x.offer.fromDate), x.poi.name_zh),
      small(TEXT.breakfast.take, () => actions.takeBreakfast(d.date, x.poi.id)),
      ...introLines(x.poi, x.note),
    ])),
    // 現場套過改案的那天（plan.applied）：分數是整條序列重算的（走過的＋改案），前面標「現場改過」
    el('p', { class: 'muted small', text: plan.applied ? `${TEXT.appliedLine}，${TEXT.dayScore(plan.score, plan.penaltyMin)}` : TEXT.dayScore(plan.score, plan.penaltyMin) }),
    openSlotLine(plan, day),
    firstLegLine(plan, d, state, actions),
  ]);
  // 累積型警告（今天走路會到 N 分、連跑）每站都會再響一次，只在第一次超過的那站寫
  const seenCumulative = new Set();
  plan.sequence.forEach((s, i) => block.append(stopCard(s, i, plan, d, state, actions, seenCumulative)));
  if (plan.dropped.length) {
    // 排不進的每一條（must 的除外）多一顆「排到別天」：直接順延到別的排得進的日子（T16；原話 #119）
    block.append(el('details', { class: 'dropped' }, [
      el('summary', { text: `${TEXT.dropped}：${plan.dropped.length}` }),
      el('ul', {}, plan.dropped.map((x) => el('li', {}, [
        el('strong', { text: x.poi.name_zh }), ` ${x.reason}`,
        // 順延過來卻排不進的（picks[].deferredFrom → dropped[].deferredFrom；整趟警告 deferred-dropped 畫面沒畫，這裡寫）
        x.deferredFrom ? el('span', { class: 'muted small', text: `　${TEXT.deferredDroppedNote(dateLabel(x.deferredFrom))}` }) : null,
        x.priority === 'must' ? null : el('button', { class: 'btn quiet sm', type: 'button', onclick: () => actions.deferStop(d.date, x.poi.id) }, TEXT.deferButton),
      ]))),
    ]));
  }
  return block;
}

/** 一家店名下面的說明行（各自一行、整段不截）：那一餐的說明（「可以當早餐：…」，有才有）與簡介。放在 .choice／.day-note／.btn.alt 裡，CSS 的 .intro 讓它換行。 */
function introLines(poi, note = null, cls = 'muted small intro') {
  const intro = introOf(poi);
  return [note ? el('span', { class: cls, text: note }) : null, intro ? el('span', { class: cls, text: intro }) : null];
}

/**
 * 二選一那行（T16；DESIGN §6.3.2「卡上顯示『或 B』」）：這站在 plan.choices 裡就在店名下面寫「或 [B]」——B 是一顆小鍵，按了把 A 換成 B、A 順延到別天（app.js chooseOption）；
 * B 來自今天排不進的同類勾選站就補一句「今天只塞得下一家」，來自候選池就寫順路／多繞幾分。沒按＝照引擎；選完 B 進 picks、這行就不再出現。
 * 下面再一行 B 的簡介（有才畫；跟「換一家」同一個理由，原話 #177「單看店名 我會不清楚選哪間好」，推導）。
 */
function choiceLine(s, plan, d, state, actions) {
  const c = choiceOf(plan, s.poi.id);
  if (!c?.altPoi) return null;
  const b = state.pois[c.altPoi.id] ?? c.altPoi;
  return el('p', { class: 'choice small' }, [
    el('span', { class: 'muted', text: TEXT.orChoice }),
    el('button', { class: 'btn quiet sm', type: 'button', onclick: () => actions.chooseOption(d.date, s.poi.id, b) }, b.name_zh),
    el('span', { class: 'muted', text: c.source === 'dropped' ? TEXT.choiceDroppedNote : TEXT.swapNote(c.detourMin) }),
    ...introLines(b),
  ]);
}

/**
 * 早餐卡上的「或 X（8/13 沒去的）」（原話 #197；跟二選一那行同一種樣式，一天有兩筆就兩行）：他之前按「吃飯店早餐」「改天去」而沒去到的那家可以排在這天——
 * X 是一顆小鍵，按了把這天的早餐換成它（app.js takeBreakfast）、不自動換；後面寫哪一天沒去的、順路或多繞幾分，下面是 X 能當早餐的說明與簡介。
 */
function offerLine(x, d, actions) {
  return el('p', { class: 'choice small' }, [
    el('span', { class: 'muted', text: TEXT.orChoice }),
    el('button', { class: 'btn quiet sm', type: 'button', onclick: () => actions.takeBreakfast(d.date, x.poi.id) }, x.poi.name_zh),
    el('span', { class: 'muted', text: `${TEXT.breakfast.offerFrom(monthDay(x.offer.fromDate))}${TEXT.swapNote(x.offer.detourMin)}` }),
    ...introLines(x.poi, x.note),
  ]);
}

/**
 * 留白行（profile §8、DESIGN §4、§8）：這天的留白已從時窗尾端扣掉（trip.js dayWindow，排在最後），站與站之間等開門的分鐘算用掉（原話 #155「當成留白 但也要罰」）；
 * departure 日或這天設 0 寫「這天沒留白」；時窗太短沒扣的（抵達日很晚落地）寫出來，不假裝有留。
 * 釘住順序的日子（安插之後）這條順序用到留白就多寫一句「調過的行程用掉 N 分」（plan.openSlotUsedMin；留白本來就是留給臨時起意的）。
 */
function openSlotLine(plan, day) {
  const raw = day.windowRaw ?? day.window;
  if (day.openSlotSkipped) return el('p', { class: 'muted small', text: TEXT.openSlotSkipped(raw.endMin - raw.startMin) });
  if (!(day.openSlotMin > 0)) return el('p', { class: 'muted small', text: TEXT.openSlotNone });
  const used = Math.max(0, Math.round(plan.sequence.reduce((s, x) => s + (x.waitMin ?? 0), 0)));
  return el('p', { class: 'muted small', text: TEXT.openSlotLine(day.openSlotMin, used, plan.pinned ? Math.round(plan.openSlotUsedMin ?? 0) : 0) });
}

/** 出門那一段：幾點出門、從住宿到第一站走幾分（原本只畫站與站之間，第一段看不到）；路線從住宿出發，住宿沒座標就不帶起點。走廊清單的 legIndex 0 就是這段。 */
function firstLegLine(plan, d, state, actions) {
  const first = plan.sequence[0];
  if (!first) return null;
  const home = resolveHome(state.trip, d.date);
  const leg = state.legFn(home, first.poi);
  const legText = leg.rideMin > 0 ? TEXT.rideTo(leg.walkMin, leg.rideMin) : TEXT.walkTo(leg.walkMin);
  const travel = (leg.walkMin ?? 0) + (leg.rideMin ?? 0) + (leg.waitMin ?? 0);
  const line = el('p', { class: 'leg muted small' }, [
    `↓ ${TEXT.firstLeg(hm(first.arriveMin - travel), legText)}${waitText(first)}`,
    routeLink({ from: coordQuery(home) ? home : null, to: first.poi, leg, state }),
  ]);
  return legBlock({ line, legIndex: 0, plan, d, state, actions });
}

/**
 * 一段移動＋走廊清單（T15；原話 #57、#124；DESIGN §1.9「走廊清單不是站」）：這段會經過的店有就在移動那行多一顆小鍵「經過 N 家」，
 * 點開列每家（店名、店型、進去約幾分、離路線幾公尺、簡介）＋「升級成站」「我進去了」；長段（trip.js leg-suggest：走 ≥10 分又有店）改成整行提示鍵
 * 「這段走 N 分，經過 X、Y，可升級」——提示樣式（主色虛線框），不是黃字警告。legIndex 0＝住宿→第一站。
 * 開合記在 state.corridorOpen（corridorDisclosure）：按「我進去了」、升級排不下跳選項都只重畫，清單還開著；重排才收起。
 */
function legBlock({ line, legIndex, plan, d, state, actions }) {
  const pois = corridorOfLeg(plan, legIndex);
  if (!pois.length) return line;
  const suggest = legSuggestOf(plan, legIndex);
  const block = el('div', { class: 'leg-block' }, [line]);
  // 提示鍵只點名兩家、用短店名（規格的「經過 X、Y」；三家在 390px 會疊到三行，10-16 實測 119px 高；帶研究註記的全名兩家也疊到 98px），其餘寫「等 N 家」，點開才全列
  const { names, more } = corridorNames(pois, 2);
  const toggle = el('button', { class: suggest ? 'btn leg-hint' : 'btn tiny quiet', type: 'button' }, suggest ? TEXT.corridorSuggest(suggest.walkMin, TEXT.corridorList(names, more)) : TEXT.corridorCount(pois.length));
  if (suggest) block.append(toggle); else line.append(toggle);
  corridorDisclosure({ key: `plan:${d.date}:${legIndex}`, state, button: toggle, box: block, build: () => corridorListNode({ pois, date: d.date, state, actions, upgrade: true, legIndex, extra: (poi) => insertAskNode(poi, d.date, legIndex, state, actions) }) });
  return block;
}

/**
 * 升級成站排不下時，那一家底下的那組選項（原話 #194「再跳一組選項問我 要壓縮哪個行程或是砍掉」；state.insertAsk 對得上這一家才畫，ui/insert.js askView 算要畫什麼）：
 * 一句為什麼排不下（引擎那幾條硬規則的句子）、前幾輪選過的、每個選項一顆鍵——鍵上寫做什麼（「Y 少待 20 分（60→40）」「不去 Z」「X 只待 30 分」）與後果
 * （排得下：後面順延幾分、用掉幾分留白、會多哪一句黃字；還排不下：還差幾分），鍵底下那一站的簡介（原話 #193）；最後一顆「算了，不插」。
 * 選了還排不下就換成下一輪的選項（app.js pickInsertOption），最多三輪。
 * 選項有 ASK_TOP_CANCEL_FROM 個以上時，「算了，不插」在提示那一行的行尾也放一顆：選項多的時候這一塊在手機上比一個螢幕還長（11-12 畫面審查量的：390px 最高 1,995px），
 * 之前只有最底下那一顆，要捲到底才收得掉。
 */
const ASK_TOP_CANCEL_FROM = 3;
function insertAskNode(poi, date, legIndex, state, actions) {
  const ask = state.insertAsk;
  if (!ask || ask.date !== date || ask.legIndex !== legIndex || ask.poiId !== poi.id) return null;
  const v = askView(ask, (id) => state.pois[id]?.name_zh ?? id, state.plans[date]?.plan ?? null);
  const optionButton = (row) => el('button', { class: 'btn alt', type: 'button', onclick: () => actions.pickInsertOption(row.option) }, [
    el('strong', { text: row.label }), ` · ${row.note}`,
    row.adds ? el('span', { class: 'intro adds', text: row.adds }) : null,
    row.intro ? el('span', { class: 'intro', text: row.intro }) : null,
  ]);
  const topCancel = v.fits.length + v.more.length >= ASK_TOP_CANCEL_FROM;
  return el('div', { class: 'insert-ask' }, [
    v.chosen.length ? el('p', { class: 'small', text: TEXT.insert.chosen(v.chosen.join('、')) }) : null,
    el('p', { class: 'warn-line small', text: v.why }),
    el('p', { class: 'muted small ask-head' }, [v.prompt, topCancel ? el('button', { class: 'btn quiet sm', type: 'button', onclick: () => actions.cancelInsert() }, TEXT.insert.cancel) : null]),
    ...v.fits.map(optionButton),
    v.moreHead ? el('p', { class: 'muted small', text: v.moreHead }) : null,
    ...v.more.map(optionButton),
    el('div', { class: 'actions' }, [el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.cancelInsert() }, TEXT.insert.cancel)]),
  ]);
}

/** 到了還沒開門要等的分鐘：超過 5 分才寫，讓他看得出中間那段空白是等開門、不是漏排。 */
function waitText(stop) {
  return stop?.waitMin > 5 ? `，${TEXT.waitOpen(Math.round(stop.waitMin))}` : '';
}

/**
 * 黃字清單；hint 的（他拒絕過引擎插的站之後連跑與等開門只提醒不催、他勾的站趕不上末班車、一日遊晚回城、今天沒排早餐）用提示樣式。
 * extra(w) 回一個節點就接在那一條後面（「今天沒排早餐」旁的小鍵）。
 */
function warnList(warns, extra = null) {
  return el('ul', { class: 'warn-list' }, warns.map((w) => el('li', { class: w.hint ? 'hint' : null }, [w.msg, extra ? extra(w) : null])));
}

/** 這一段的 Google Maps 路線（新分頁）；from 不給就從現在位置出發。 */
function routeLink({ from, to, leg, state }) {
  return el('a', { href: routeUrl({ from, to, mode: legMode(leg), cityName: tripCityName(state) }), target: '_blank', rel: 'noopener' }, TEXT.routeLink);
}

const CUMULATIVE_RULES = new Set(['walk-budget', 'walk-run', 'shop-run']);

/**
 * 引擎排進來的站，卡上那一句說明：哪一種看 stop.priority（'breakfast' 早餐、'filler' 填空檔、'onway' 順路、其餘恢復站），不看店型——恢復型的店也可能是填站；坐下來的地方另有一句。
 * isBreakfast＝這一站真的是這天的早餐（breakfastCardOf 有值）：引擎排的早餐後來不再是當天那一餐時（他在它前面插了一家能當早餐的店，早餐的小標與鍵移到那一家），
 * 這張卡的鍵是一般的「不去了」，那一句也要用一般的寫法——之前照 priority 寫「不合意就按『換一家』；也可以改天去、或吃飯店早餐」，叫他按的鍵卡上沒有（11-12 畫面審查）。
 */
function engineNote(s, isBreakfast = false) {
  if (s.priority === 'breakfast') return isBreakfast ? TEXT.breakfast.inserted : TEXT.engineInserted;
  if (s.poi.category === 'spot') return TEXT.spotInserted(hm(s.endMin));
  return s.priority === 'filler' ? TEXT.fillerInserted : s.priority === 'onway' ? TEXT.onTheWayInserted : TEXT.restInserted;
}

function stopCard(s, i, plan, d, state, actions, seenCumulative = new Set()) {
  const poi = s.poi;
  const next = plan.sequence[i + 1];
  const legNext = next ? state.legFn(poi, next.poi) : null;
  // 釘起訖的固定時段站（研討會、演唱會）寫「HH:MM 散場」，跟現場頁一樣（10-14 T23）；其他站寫幾點關
  const ends = Number.isFinite(s.fixedWindow?.endMin) ? hm(s.fixedWindow.endMin) : null;
  const closes = ends ? null : closeHm(poi, d.date);
  // 白天站沒有幾點關：在同一個位置寫「天黑 HH:MM 前」（原話 #159）；位置不明就不寫
  const dark = ends || closes ? null : darkBeforeMinOf(poi, d.date, state);
  const limitText = ends ? TEXT.endsAt(ends) : closes ? TEXT.closesAt(closes) : dark != null ? TEXT.darkBefore(hm(dark)) : '';
  // 等開門那段已在站間那行寫「等開門 N 分（算留白）」，wait-at-door 的黃字不再寫一次
  const warns = plan.warnings.filter((w) => {
    if (w.poiId !== poi.id || w.code === 'skipped-missing' || w.ruleId === 'wait-at-door') return false;
    if (CUMULATIVE_RULES.has(w.ruleId)) { if (seenCumulative.has(w.ruleId)) return false; seenCumulative.add(w.ruleId); }
    return true;
  });
  // 這一站是這天的早餐（plan.meals.breakfast；原話 #196）：店型旁多一個「早餐」小標、鍵換成「換一家」「改天去」「吃飯店早餐」（沒有「不去了」）；引擎先挑的也能換一家
  const bf = breakfastCardOf(plan, s);
  const engine = s.insertedBy === 'engine';
  const cat = el('span', { class: 'cat', text: CATEGORY[poi.category] ?? '' });
  const card = el('article', { class: `card${s.isAnchor ? ' anchor' : ''}${poi.recovery ? ' rest' : ''}` }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'time', text: `${hm(s.startMin)}–${hm(s.endMin)}` }),
      bf ? el('span', { class: 'tags' }, [cat, el('span', { class: 'cat meal', text: TEXT.breakfast.tag })]) : cat,
      poi.item ? el('span', { class: 'cat item', text: poi.item }) : null,
    ]),
    el('h3', { text: poi.name_zh }),
    // 這站自己的簡介緊跟店名；「或 B」那行（帶 B 的簡介）放在它後面，兩段簡介才各自跟著各自的店名（10-27 截圖：B 的簡介夾在 A 名字與 A 簡介之間會讀錯）
    el('p', { class: 'muted small', text: [introOf(poi) ?? '', limitText].filter(Boolean).join('　') }),
    // 二選一沒選的那家順延到這天（picks[].deferredFrom → stop.deferredFrom；DESIGN §4 Stop.deferredFrom）
    s.deferredFrom ? el('p', { class: 'muted small', text: TEXT.deferredFrom(dateLabel(s.deferredFrom)) }) : null,
    choiceLine(s, plan, d, state, actions),
    ...(bf ? offersOn(plan, poi.id, state.pois).map((x) => offerLine(x, d, actions)) : []),
    warns.length ? warnList(warns) : null,
    engine ? el('p', { class: 'muted small', text: engineNote(s, Boolean(bf)) }) : null,
    el('div', { class: 'actions' }, [
      // 引擎插的站不在 picks 裡，「換一家」接不上；「不去了」會記進 day.removed，下次重排就不再插＝拒絕（原話 #126）。引擎先挑的早餐例外：能換，換了就變成他勾的
      // 引擎插的站不是 designated 也不是 anchor（core 只從候選帶這兩個旗標），所以「不去了」照這個條件一定會出現
      engine && !bf ? null : el('button', { class: 'btn', type: 'button', onclick: () => toggleSwap(card, s, d, state, actions) }, TEXT.swap),
      ...(bf?.keys
        ? [el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.breakfastOff(d.date, 'later') }, TEXT.breakfast.later), el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.breakfastOff(d.date, 'hotel') }, TEXT.breakfast.hotel)]
        : [s.designated || s.isAnchor ? null : el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.removeStop(d.date, poi.id, s.insertedBy, s.priority) }, TEXT.remove)]),
      el('a', { class: 'btn quiet', href: placeUrl(poi, tripCityName(state)), target: '_blank', rel: 'noopener' }, TEXT.mapLink),
    ]),
  ]);
  if (legNext) {
    const legText = legNext.rideMin > 0 ? TEXT.rideTo(legNext.walkMin, legNext.rideMin) : TEXT.walkTo(legNext.walkMin);
    const line = el('p', { class: 'leg muted small' }, [`↓ ${legText}${waitText(next)}`, routeLink({ from: poi, to: next.poi, leg: legNext, state })]);
    // 這段是第 i+1 段（0＝住宿→第一站），走廊清單掛在它旁邊
    card.append(legBlock({ line, legIndex: i + 1, plan, d, state, actions }));
  }
  return card;
}

/**
 * 換一家清單（展開收合只動 DOM）：最上面一句講在換哪一餐（「晚餐換一家」「早餐換一家」；不是哪一餐就不寫，原話 #195），最多列六家——
 * 店名、順路或多繞幾分、那一餐的說明（「可以當晚餐：…」，有才有、不分店型）、簡介。要列誰在 ui/meals.js swapListOf：午餐晚餐只列能當那一餐的店，早餐走早餐自己的清單。
 */
function toggleSwap(card, s, d, state, actions) {
  const existing = card.querySelector('.swap-list');
  if (existing) { existing.remove(); return; }
  const { title, cands, breakfast, empty } = swapListOf(state, d.date, s);
  const list = el('div', { class: 'swap-list' });
  if (title) list.append(el('p', { class: 'muted small', text: title }));
  // 沒有候選時那一句照餐別寫（「附近沒有能當晚餐、順路又開著的店」；不是哪一餐才寫「同類型」）——上面那句是「晚餐換一家」，下面不能寫「沒有同類型的店」
  if (!cands.length) list.append(el('p', { class: 'muted small', text: empty }));
  for (const c of cands.slice(0, 6)) {
    list.append(el('button', { class: 'btn alt', type: 'button', onclick: () => actions.swapStop(d.date, s.poi.id, c.poi, { breakfast }) }, [
      el('strong', { text: c.poi.name_zh }), ` · ${TEXT.swapNote(c.detourMin)}`, c.open === null ? ` · ${TEXT.openUnknown}` : '',
      // 每家下面的說明與簡介，整段、不截（原話 #177「換一家 跳出來的選項 也要有簡介 不然單看店名 我會不清楚選哪間好」）；<button> 裡只能放 phrasing content，用 span 配 CSS display:block 換行
      ...introLines(c.poi, c.note, 'intro'),
    ]));
  }
  card.append(list);
}

function closeHm(poi, date) {
  const iv = openIntervals(poi, date);
  if (!iv || !iv.length) return null;
  return hm(Math.max(...iv.map(([, c]) => c)));
}
