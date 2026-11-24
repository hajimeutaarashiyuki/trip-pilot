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
import { choiceOf, dayChoices } from './choices.js';
import { askView } from './insert.js';
import { breakfastCardOf, swapListOf, offersOn, looseOffers, breakfastOffText, hasLaterDay } from './meals.js';
import { CUMULATIVE_RULES } from './other-days.js';   // 累積型的黃字只在第一次超過的那站寫；復原列數「這天多幾句提醒」用同一份（addedWarnings）

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
  // 這天可以出的「或 B」：先試排過、選了會讓其餘各站少掉或換位置的不出（ui/choices.js dayChoices；11-24 起不分釘不釘住；同一份行程只試一次）
  const choices = dayChoices(state, d.date);
  plan.sequence.forEach((s, i) => block.append(stopCard(s, i, plan, d, state, actions, seenCumulative, choices)));
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
 * 二選一那行（T16；DESIGN §6.3.2「卡上顯示『或 B』」）：這站在這天可以出的二選一裡（choices＝ui/choices.js dayChoices：引擎給的 plan.choices 裡試排過、選了沒事的）
 * 就在店名下面寫「或 [B]」——B 是一顆小鍵，按了把 A 換成 B、A 順延到別天（app.js chooseOption；B 就在 A 的原位置、那天從此照他調過的順序排）；
 * B 來自今天排不進的同類勾選站就補一句「今天只塞得下一家」，來自候選池就寫順路／多繞幾分。沒按＝照引擎；選完 B 進 picks、這行就不再出現。
 * 下面再一行 B 的簡介（有才畫；跟「換一家」同一個理由，原話 #177「單看店名 我會不清楚選哪間好」，推導）。
 */
function choiceLine(s, choices, d, state, actions) {
  const c = choiceOf(choices, s.poi.id);
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
 * 最上面照舊——前幾輪選過的、一句為什麼排不下（引擎那幾條硬規則的句子）、提示句（行尾可以多一顆「算了，不插」）；最底下一顆「算了，不插」。
 * 中間的選項分兩組、各一行小標（11-17，主控定的版面）：「少待一點」與「這站不去」，沒有選項的那一組不畫。每個選項是一整列可以按的鍵（至少 44px 高），三行——
 * 第一行：粗體店名（要插的這家後面標「（要插的這家）」）＋靠右的重點（少待寫「90 → 80 分」、不去寫店型小標；引擎排的站再多一個小標「引擎排的」）；
 * 第二行：後果（排得下：後面順延或提早幾分、用掉幾分留白；還排不下：還差幾分），選了會多出來的黃字另起一行（warn 色）；
 * 第三行：那一站的簡介（原話 #193），最多兩行、超過截斷（樣式 .opt-intro 的 line-clamp；完整的在那一站自己的卡上）；
 *   選項有 ASK_ONE_LINE_FROM 個以上時收成一行（那一塊加 .many）——量出來的：四個以下的兩行也看得完，五個以上要收成一行才進得了一個螢幕。
 * 之前每顆鍵是一整行粗體把動作與後果混在一起、下面接整段簡介：390×844 上 28 組的高度中位數 1,122px、17 組超過一個螢幕；量過的幾種排法見 src/index.html .insert-ask 那一段。
 * 選了還排不下就換成下一輪的選項（app.js pickInsertOption），最多三輪。
 * 選項有 ASK_TOP_CANCEL_FROM 個以上時，「算了，不插」在提示那一行的行尾也放一顆（11-12 畫面審查：選項多的時候要捲到底才收得掉）。
 * 「這站不去」那一組有 ASK_DROP_SHOWN＋ASK_DROP_HIDE_MIN 個以上（6 個以上）時先列前 ASK_DROP_SHOWN 個（照引擎給的先後），其餘收在一顆「再列 N 站」後面
 * （11-24，主控定；門檻 4 是預設；「至少藏 2 個才收」是同日傍晚的裁決乙5——剛好 5 個全列：收 1 個只換來一顆 44px 的鍵，那一塊只矮 35px）：按了在原位置展開、不再收回
 * （記在這一輪的 state.insertAsk.showAll：重畫還開著；下一輪是新的一組選項，重新收合）。「少待一點」那一組不收。那顆是真的 <button>，鍵盤也按得到，按了焦點移到第一個新出來的選項。
 * 為什麼收：選項多的時候那一塊超過一個螢幕（11-17 量試走版 17 組裡 14 組；8/13 每次 7–12 個選項、其中 9 個「這站不去」）。
 * 11-24 實量（Chrome 157 headless、390×844，三個打包檔每一段走廊清單的每一家各按一次「升級成站」，跳選項的每一組量那一塊的高度；中位數／最高／超過 844px 的組數）：
 *   試走版 17 組：全列 1205／1352／14 組 → 門檻 3：733／880／3 組｜門檻 4：816／963／6 組｜門檻 5：899／1046／9 組；
 *   七天包 19 組：全列 746／1312／4 組 → 門檻 3：746／1172／3 組｜門檻 4：746／1255／4 組｜門檻 5 沒有一組會收；
 *   公務版 20 組：全列 350／1019／3 組 → 門檻 3：350／984／2 組｜門檻 4、5 跟全列一樣。
 * 七天包與公務版超過一個螢幕的那幾組高在「少待一點」（最多 6 個、不收），「這站不去」最多 5 個——只收 1 個時換來一顆 44px 的鍵，那一塊只矮 35px。
 * 改成「至少藏 2 個才收」之後同一套重量（11-24 傍晚；畫出來的中位數／最高／超過 844px 的組數）：試走版 816／963／6 組（14 組會收，各藏 3–5 個，跟門檻 4 那一行相同）；
 *   七天包 746／1312／4 組、公務版 350／1019／3 組——這兩包沒有一組會收（之前各有 3 組、2 組只藏 1 個），等於全列。
 */
const ASK_TOP_CANCEL_FROM = 3;
const ASK_ONE_LINE_FROM = 5;
const ASK_DROP_SHOWN = 4;
const ASK_DROP_HIDE_MIN = 2;   // 至少藏這麼多個才收（11-24 傍晚主控裁決乙5）：「這站不去」有 6 個以上才列前 4 個＋「再列 N 站」，剛好 5 個全列
function insertAskNode(poi, date, legIndex, state, actions) {
  const ask = state.insertAsk;
  if (!ask || ask.date !== date || ask.legIndex !== legIndex || ask.poiId !== poi.id) return null;
  const v = askView(ask, (id) => state.pois[id]?.name_zh ?? id, state.plans[date]?.plan ?? null);
  // <button> 裡只能放 phrasing content：每一行都是 span，用樣式排成一行一行
  const optionButton = (row) => el('button', { class: 'btn alt opt', type: 'button', onclick: () => actions.pickInsertOption(row.option) }, [
    el('span', { class: 'opt-top' }, [
      el('span', { class: 'opt-name' }, [el('strong', { text: row.name }), row.mine ? el('span', { class: 'opt-mine', text: TEXT.insert.mine }) : null]),
      el('span', { class: 'opt-side' }, [row.side, row.cat ? el('span', { class: 'cat', text: row.cat }) : null, row.engine ? el('span', { class: 'cat', text: TEXT.insert.engineTag }) : null]),
    ]),
    el('span', { class: 'opt-note', text: row.note }),
    row.adds ? el('span', { class: 'opt-note adds', text: row.adds }) : null,
    row.intro ? el('span', { class: 'opt-intro', text: row.intro }) : null,
  ]);
  const count = v.fits.length + v.more.length;
  const topCancel = count >= ASK_TOP_CANCEL_FROM;
  // 一組的選項鍵；「這站不去」至少多出 ASK_DROP_HIDE_MIN 個（6 個以上）而且還沒展開過：前 ASK_DROP_SHOWN 個＋「再列 N 站」
  const groupNodes = (g) => {
    if (g.key !== 'drop' || ask.showAll || g.rows.length < ASK_DROP_SHOWN + ASK_DROP_HIDE_MIN) return g.rows.map(optionButton);
    const rest = g.rows.slice(ASK_DROP_SHOWN);
    const more = el('button', { class: 'btn quiet ask-more', type: 'button' }, TEXT.insert.more(rest.length));
    more.addEventListener('click', () => { ask.showAll = true; const nodes = rest.map(optionButton); more.replaceWith(...nodes); nodes[0].focus(); });
    return [...g.rows.slice(0, ASK_DROP_SHOWN).map(optionButton), more];
  };
  return el('div', { class: count >= ASK_ONE_LINE_FROM ? 'insert-ask many' : 'insert-ask' }, [
    v.chosen.length ? el('p', { class: 'small', text: TEXT.insert.chosen(v.chosen.join('、')) }) : null,
    el('p', { class: 'warn-line small', text: v.why }),
    el('p', { class: 'muted small ask-head' }, [v.prompt, topCancel ? el('button', { class: 'btn quiet sm', type: 'button', onclick: () => actions.cancelInsert() }, TEXT.insert.cancel) : null]),
    ...v.groups.flatMap((g) => [el('p', { class: 'small ask-group', text: g.head }), ...groupNodes(g)]),
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

/**
 * 引擎排進來的站，卡上那一句說明：哪一種看 stop.priority（'breakfast' 早餐、'filler' 填空檔、'onway' 順路、其餘恢復站），不看店型——恢復型的店也可能是填站；坐下來的地方另有一句。
 * isBreakfast＝這一站真的是這天的早餐（breakfastCardOf 有值）：引擎排的早餐後來不再是當天那一餐時（他在它前面插了一家能當早餐的店，早餐的小標與鍵移到那一家），
 * 這張卡的鍵是一般的「不去了」，那一句也要用一般的寫法——之前照 priority 寫「不合意就按『換一家』；也可以改天去、或吃飯店早餐」，叫他按的鍵卡上沒有（11-12 畫面審查）。
 */
function engineNote(s, isBreakfast = false, later = true) {
  // later＝這張早餐卡有「改天去」（旅程最後一天沒有）：沒有那顆鍵就不叫他按它
  if (s.priority === 'breakfast') return isBreakfast ? (later ? TEXT.breakfast.inserted : TEXT.breakfast.insertedLast) : TEXT.engineInserted;
  if (s.poi.category === 'spot') return TEXT.spotInserted(hm(s.endMin));
  return s.priority === 'filler' ? TEXT.fillerInserted : s.priority === 'onway' ? TEXT.onTheWayInserted : TEXT.restInserted;
}

function stopCard(s, i, plan, d, state, actions, seenCumulative = new Set(), choices = []) {
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
  // 這一站是這天的早餐（plan.meals.breakfast；原話 #196）：店型旁多一個「早餐」小標、鍵換成「換一家」「改天去」「吃飯店早餐」（沒有「不去了」）；引擎先挑的也能換一家。
  // 旅程最後一天不出「改天去」（後面沒有日子可以去；ui/meals.js hasLaterDay）
  const bf = breakfastCardOf(plan, s);
  const later = Boolean(bf?.keys) && hasLaterDay(state.trip, d.date);
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
    choiceLine(s, choices, d, state, actions),
    ...(bf ? offersOn(plan, poi.id, state.pois).map((x) => offerLine(x, d, actions)) : []),
    warns.length ? warnList(warns) : null,
    engine ? el('p', { class: 'muted small', text: engineNote(s, Boolean(bf), later) }) : null,
    el('div', { class: 'actions' }, [
      // 引擎插的站不在 picks 裡，「換一家」接不上；「不去了」會記進 day.removed，下次重排就不再插＝拒絕（原話 #126）。引擎先挑的早餐例外：能換，換了就變成他勾的
      // 引擎插的站不是 designated 也不是 anchor（core 只從候選帶這兩個旗標），所以「不去了」照這個條件一定會出現
      engine && !bf ? null : el('button', { class: 'btn', type: 'button', onclick: () => toggleSwap(card, s, d, state, actions) }, TEXT.swap),
      ...(bf?.keys
        ? [later ? el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.breakfastOff(d.date, 'later') }, TEXT.breakfast.later) : null, el('button', { class: 'btn quiet', type: 'button', onclick: () => actions.breakfastOff(d.date, 'hotel') }, TEXT.breakfast.hotel)]
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
 * 換一家清單（展開收合只動 DOM）：最上面一句講在換哪一餐（「晚餐換一家」「早餐換一家」；不是哪一餐就不寫，原話 #195），最多列六家（早餐的清單合格的全列）——
 * 店名、順路或多繞幾分、那一餐的說明（「可以當晚餐：…」，有才有、不分店型）、簡介。要列誰、取哪幾家都在 ui/meals.js swapListOf（回來的就是要畫的那幾家，每一家都試排過）：
 * 午餐晚餐只列能當那一餐的店，早餐走早餐自己的清單；別天已經排了的店排在後面、店名後多一個小標「8/15（六）已排」「8/13（四）勾了沒排進」，選了就把它挪過來（11-24）。
 * 清單裡有帶小標的店時，餐別那一句下面多一行說明（swapListOf 的 hint）。
 * 「· 多繞 N 分」連分隔點包成不換行的一塊（.nb；前面隔一個可以換行的空白）：之前是一段字，390 寬會斷成「· 多」＋下一行「繞 7 分」、或把「·」留在行尾（11-24 傍晚主控截圖）。
 * 「· 營業時間沒查到，要先確認」整句太長、不包：分隔點用不斷行空白黏在第一個字前面，字照常換行。
 */
function toggleSwap(card, s, d, state, actions) {
  const existing = card.querySelector('.swap-list');
  if (existing) { existing.remove(); return; }
  const { title, cands, breakfast, empty, hint } = swapListOf(state, d.date, s);
  const list = el('div', { class: 'swap-list' });
  if (title) list.append(el('p', { class: 'muted small', text: title }));
  if (hint) list.append(el('p', { class: 'muted small', text: hint }));
  // 沒有候選時那一句照餐別寫（「附近沒有能當晚餐、順路又開著的店」；不是哪一餐才寫「同類型」）——上面那句是「晚餐換一家」，下面不能寫「沒有同類型的店」
  if (!cands.length) list.append(el('p', { class: 'muted small', text: empty }));
  for (const c of cands) {
    list.append(el('button', { class: 'btn alt', type: 'button', onclick: () => actions.swapStop(d.date, s.poi.id, c.poi, { breakfast }) }, [
      el('strong', { text: c.poi.name_zh }), c.tag ? el('span', { class: 'cat', text: c.tag }) : null, ' ', el('span', { class: 'nb', text: `· ${TEXT.swapNote(c.detourMin)}` }), c.open === null ? ` · ${TEXT.openUnknown}` : '',
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
