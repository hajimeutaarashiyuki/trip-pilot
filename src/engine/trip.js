// 整趟：把旅程的每一天交給 planDay（第一版：分天是他在規劃頁點的，引擎只排單日；決策樹 Q7）。
// 這裡負責把 Trip／Day 的資料翻成 planDay 要的 day 上下文：時窗、早起日、晚出門、一日遊、主題、主行程、指定站、當日區域。
import { planDay } from './core.js';
import { hmToMin, openIntervals, overlapMin } from './time.js';
import { haversineM } from '../geo/matrix.js';
import { distToSegmentM } from '../geo/corridor.js';
import { evaluateSequence, retimeSequence } from './sequence.js';
import { SHOPPING_CATEGORIES } from '../rules/_helpers.js';   // 只借購物類店型清單篩順路站，不是規則邏輯（規則在 rules/shopping-day.js）
import { CATEGORIES, classifyCategory } from '../data/schema.js';   // 主題日的店型要對得上知識庫的店型（themeCategoryOf）
import { proposeChoices, swappedAwayFrom } from './choices.js';   // 二選一（T16）：七天排完才對每天的序列算，不進分數與時刻；choices.js 的 defer 反過來用 planTrip 試排（模組互相引用只在呼叫時用到，沒問題）
import { personsOf, presentOn, mergeAdjustments, personAvoids, personAvoidWarnings, cityNamesOf } from './persons.js';   // 同行者（T19）：每天在場的人、合併後的調整（取最鬆，原話 #144）、不想去的店型
import { nightWalkCapMin, taxRefundBufferMin } from '../data/country.js';   // 國家層（T20）：離境日免稅緩衝、夜間步行風險對時窗尾端的上限（誰讀哪個鍵都記在 data/country.js）

/**
 * 引擎插站的觸發：照他勾的排完後出現這些規則的警告才跑第二趟。
 * walk-run：DESIGN §1.3「走路連跑要破 150 才由引擎插恢復站」→ restCandidates（只拿恢復站，priority 'rest'）；
 * wait-at-door：等開門空檔填站，任何站都可以（原話 #161）→ fillCandidates（那段空檔內有開、離空檔最近的任何站型，priority 'filler'，綁在空檔內）。
 * 恢復站與填站一天合計最多插 settings.restInsertMaxPerDay 家（core.js maxOptional）。
 */
export const REST_TRIGGER_RULES = new Set(['walk-run', 'wait-at-door', 'late-departure']);
/** 觸發規則 → 它插的站的種類；拒絕過哪一種就不再插那一種、那條警告降成提示 */
const TRIGGER_KIND = Object.freeze({ 'walk-run': 'rest', 'wait-at-door': 'filler', 'late-departure': 'filler' });

/**
 * 一天的時窗：預設 settings.dayWindow；晚出門日（旅程第 lateStartFromDay 天起、非一日遊、只有 normal 日）起點改 lateStartHM；早起日由 day.earlyDay 自帶出門時刻；
 * fixed 日（研討會那種整天被一件事釘住的日子，DESIGN §11.1 Q7）照 normal 的預設時窗、不套晚出門：出門時間由固定時段決定（會場是帶 fixedWindow 的站，
 * 排程自己對齊卡位時刻；要早於 09:00 出門就手標 earlyDay＋departHM，自動標早起日還沒做），其餘跟 normal 一樣（推導；10-14 T23）；
 * 抵達日起點不早於落地＋出關緩衝＋機場到據點的車程、離境日終點不晚於起飛－緩衝－車程（airportTransit 由 airportTransitMin 算：
 * zones.json 的 airport|<據點區> 連結，沒有就 0；10-13 七天實驗 F1：引擎原本當他 17:00 就站在飯店門口，v4 自己也只留 35 分）。
 * 國家層（country，打包檔 pack.country；T20）兩樣：離境日再扣免稅海關確認的緩衝 country.taxRefund.bufferMin，只在旅程日期（day.date）≥ taxRefund.effectiveFrom 時扣
 * （日本 2026-11-01 起的出境退款制、45 分；仙台 2026-08 不扣；data/country.js taxRefundBufferMin）；夜間步行風險 country.transportProfile.nightWalk.risk（原話 #145）
 * mid／high 時時窗尾端最晚 23:00／22:00（預設、推導；low 與缺照 settings.dayWindow，日本 low；nightWalkCapMin）——規則 night-slot 的時段尾端同一個上限。
 * 留白從時窗尾端扣（profile §8「每天留 90 分鐘」、DESIGN §4 days[].openSlotMin）：每天的落後額度 day.openSlotMin ?? settings.openSlotMinPerDay，
 * 排程時從收工時刻扣掉＝排在最後；departure 日一律 0（那天的尾端是飛機）。
 * 扣完整天只剩 settings.openSlotSkipBelowMin（預設 60）分或更少就不扣、記警告 open-slot-skipped（推導：抵達日很晚落地那種，扣了就沒得排）。
 * 回 { startMin, endMin（扣過的收工時刻，硬規則 window 看這個）, raw: { startMin, endMin }（原時窗，給畫面與夜間站）, openSlotMin（真的扣掉的分鐘）, taxRefundBufferMin（離境日真的扣掉的免稅緩衝，其餘 0）, warnings }
 */
export function dayWindow(day, index, settings, airportTransit = 0, country = null) {
  const [start, end] = (settings.dayWindow ?? ['09:00', '24:00']).map(hmToMin);
  let startMin = start;
  if (day.earlyDay && day.departHM) startMin = hmToMin(day.departHM);
  else if (!day.earlyDay && day.type === 'normal' && index + 1 >= (settings.lateStartFromDay ?? 3) && !day.dayTrip) startMin = hmToMin(settings.lateStartHM ?? '11:00');
  if (day.type === 'arrival' && day.arriveMin != null) startMin = Math.max(startMin, day.arriveMin + (settings.arrivalBufferMin ?? 60) + airportTransit);
  let endMin = end;
  const nightCap = nightWalkCapMin(country);
  if (nightCap != null) endMin = Math.min(endMin, nightCap);
  const departing = day.type === 'departure' && day.departAirportMin != null;
  const taxBuffer = departing ? taxRefundBufferMin(country, day.date) : 0;
  if (departing) endMin = Math.min(endMin, day.departAirportMin - (settings.departureBufferMin ?? 180) - airportTransit - taxBuffer);
  const raw = { startMin, endMin };
  const wanted = day.type === 'departure' ? 0 : Math.max(0, Number(day.openSlotMin ?? settings.openSlotMinPerDay ?? 90) || 0);
  const warnings = [];
  let openSlotMin = wanted;
  if (wanted > 0 && endMin - wanted <= startMin + (settings.openSlotSkipBelowMin ?? 60)) {
    openSlotMin = 0;
    warnings.push({ code: 'open-slot-skipped', msg: `時窗只有 ${endMin - startMin} 分鐘，留白 ${wanted} 分沒從時窗扣` });
  }
  return { startMin, endMin: endMin - openSlotMin, raw, openSlotMin, taxRefundBufferMin: taxBuffer, warnings };
}

/** 機場到據點的分鐘：legFn 查 settings.airportZoneId（預設 'airport'）那一區到據點區的搭車連結（車程＋轉乘走路）；沒有連結、據點就在機場區都回 0。 */
export function airportTransitMin({ legFn, home, settings = {} }) {
  const zone = settings.airportZoneId ?? 'airport';
  if (!legFn || !home?.zoneId || home.zoneId === zone) return 0;
  const leg = legFn({ id: '__airport', name_zh: '機場', zoneId: zone }, home);
  return leg && leg.source === 'link' ? (leg.rideMin ?? 0) + (leg.walkMin ?? 0) : 0;
}

/** 當日區域（第一版）：據點的 Zone ＋ 主行程的 Zone ＋ 所有候選的 Zone；之後換成據點圈 ∪ 錨點圈 ∪ 走廊。 */
export function regionZonesOf({ home, candidates, anchorPoi }) {
  const z = new Set([home?.zoneId, anchorPoi?.zoneId, ...candidates.map((c) => c.poi.zoneId)].filter(Boolean));
  return [...z];
}

/**
 * planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool, options }) → { days: [{ date, day, plan }], warnings }
 * - trip.days[]: { date, type, earlyDay, departHM?, dayTrip?, openSlotMin?, anchor?: { poiId } | { theme, poiIds[] }, picks: [{ poiId, priority, dwellMin?, fixedWindow?, errand? }], designated?: [poiId], nightSlotOff?, removed?: [{ poiId, insertedBy?, priority? }] }
 *   anchor.theme：主題日那一類的店型鍵（vintage／record／cafe 這種；需求單上的中文會翻，翻不出記整趟警告 theme-unknown、那天當普通日；themeCategoryOf）
 *   removed 帶 insertedBy 'engine' ＝ 他拒絕過引擎插的站：那天不再插同一種（priority 'rest' 恢復站／'filler' 填站；沒記 priority 的舊資料當恢復站）
 *   （profile §2.4 細則「拒絕＝跳過，不觸發改案、不罰、當天不再重插，連跑警告降成提示」；原話 #126 拒絕的是恢復，拒絕一家填站不等於拒絕恢復）
 *   openSlotMin：這天的留白分鐘（缺＝settings.openSlotMinPerDay；departure 日 0），dayWindow 從收工時刻扣掉
 *   picks[].errand：他勾的待辦站（順路購買，原話 #29）——購物類排在非購物日不罰（rules/shopping-day.js），排進去的 stop 帶 errand
 *   picks[].fixedWindow { startMin, endMin?, arriveEarlyMin?, afterMin? }：固定時段（花火只釘開始、研討會釘起訖；DESIGN §11.1 Q7）——
 *     arriveEarlyMin 缺補 settings.fixedBeforeMin 40、有 endMin 而 afterMin 缺補 settings.fixedAfterMin 30（fixedWindowOf，都是預設）；
 *     有 endMin 又沒寫 dwellMin 的站，停留＝釘住的整段（卡位提前量＋時段＋散場緩衝，fixedSpanMin），現場頁「待 N 分」才會是真的（10-14 T23）
 *   type 'fixed'：時窗照 normal、不套晚出門（dayWindow）；夜間站照排（rules/night-slot.js）；被固定時段的站蓋住的餐段不警告（rules/meal-slots.js）；
 *     沒有一站帶 fixedWindow 的 fixed 日記整趟警告 fixed-day-no-window（那天只會照營業時間排）
 * - trip.shoppingDays?：購物日覆寫（陣列，元素 'YYYY-MM-DD' 或 { date, fromHM }）；沒有就由 shoppingDaysOf 照完整天數推（DESIGN §1.5）；
 *   寫壞了（不是陣列、fromHM 或 settings.shoppingAfternoonHM 不是 HH:MM）記整趟警告 shopping-days-bad／shopping-from-bad、照樣排（跟 pick-unknown 一樣進 warnings；畫面目前不顯示整趟警告，plan-report 會印）
 * - 每天的 day 上下文：window 是扣過留白的時窗（硬規則 window、搜尋用）、windowRaw 原時窗（畫面、夜間站）、openSlotMin 真的扣掉的分鐘、openSlotSkipped 時窗太短沒扣（整趟 warnings 另有一條 open-slot-skipped）、
 *   taxRefundBufferMin 離境日扣掉的免稅緩衝（國家層 country.taxRefund，只在旅程日期 ≥ 生效日；T20；其餘日子 0）、
 *   shoppingDay（這天是不是購物日）、shoppingFromMin（購物時段從幾分起，整天都是就 null；非購物日 false／null）
 * - pois：{ [poiId]: poi }（已 normalize）
 * - restPool：引擎可插的站的來源（已規範化的 POI 陣列，可空；畫面與報告傳整個知識庫），每天由 restCandidates（恢復站）、fillCandidates（填空檔）、onTheWayCandidates（順路站）篩，三個池都先過 engineMayInsert；
 *   走廊清單（corridorFor，T15）也從這裡挑：每段走路旁 ≤ corridorListRadiusM、經過時開著的店，掛在 plan.corridor，不是站、不進分數；七天都排完才算（exclude 含任何一天引擎插過的站）
 * - 每天的 plan 多兩樣（attachCorridor）：plan.corridor [{ legIndex, pois[{ poi, distM, open }] }]（legIndex 0＝住宿→第一站；open true 經過時有開、null 沒營業時間資料）、長段提示 leg-suggest（warnings 裡 hint: true 的一條，不罰）
 * - 二選一（T16，choices.js proposeChoices）：七天排完再對每天的序列算，掛 plan.choices [{ date, poiId: A, slot, options: [A, B], source, detourMin, altPoi }]（沒有就空陣列），不進分數與時刻；
 *   pool＝restPool，exclude＝任何一天勾過／按過「不去了」的 ∪ 任何一天序列裡的站（含引擎插的）∪ 那天之前按過「我進去了」的 ∪ 這天換掉過的與 unplaced 的（choices.js swappedAwayFrom）
 * - picks[].deferredFrom：二選一沒選的那家順延到這天（choices.js defer 寫的；DESIGN §4 Stop.deferredFrom），排進去的 stop 帶著給畫面寫「從 8/15 順延」；
 *   順延過來卻排不進（落在那天的 plan.dropped）記整趟警告 deferred-dropped（不罰、不自動改 trip.deferred）
 * - options.onlyDates: ['YYYY-MM-DD']：只排清單內的日子，其餘日子跳過 planDay（那天回 { date, day, plan: null }；day 上下文照算，整趟的 exclude 也照常算）——
 *   順延試排用，一天一天試不用整趟重算（推導）；跳過的日子沒插過的站不會進 insertedSoFar，試排的那天可能插到別天已插的引擎站，只影響引擎插站、不影響試排的結論
 * - 同行者（T19，engine/persons.js；原話 #136、#144）：trip.persons[]: [{ id, name, isMe, dates?: ['YYYY-MM-DD']（同行哪幾天；缺或空＝整趟）, adjustments: { stamina: normal|easy|hard, nightSlot: default|less|none, dislikes, avoidCategories[] } }]，persons[0] 是他；
 *   沒有 persons 就從 trip.party 合成（行為跟現在一樣）；沒有 persons 而 brief（手機需求單）的 city／dates 對得上就用需求單的 persons（stamina／nightSlot 生效、
 *   「只同行哪幾天」讀得懂的轉成 dates；城市也對 kb.city＝打包檔的城市 id 與名字，persons.js cityNamesOf）。
 *   每天的 day 多三樣：party（那天在場人數，有 dates 的只算那幾天）、persons（在場的）、adjust: { stamina, nightSlot, avoidCategories, avoidBy }（人之間取最鬆）——
 *   stamina 進 rules/_helpers.js budgetMultiplier（easy 進 min、hard 最後乘）；nightSlot none → day.nightSlotOff（跟早起日前一晚同一條路）、less → day.nightSlotLess（rules/night-slot.js 罰分減半）；
 *   avoidCategories：引擎自己插的站（恢復站、填站、順路站、坐下來的地方；現場改案的池 ui/now.js fieldPool 同）與走廊清單都不拿那些店型，他勾的照排（總則 3）＋那站一條提示 person-avoid（hint，不罰；personAvoidWarnings）；
 *   avoidCategories 翻不出店型的記整趟警告 person-avoid-unknown
 */
export function planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool = [], brief = null, options = {} }) {
  const out = []; const warnings = [];
  let prevTheme = null; let prevType = null;
  const onlyDates = Array.isArray(options.onlyDates) ? new Set(options.onlyDates) : null;
  const persons = personsOf(trip, brief, warnings, cityNamesOf(kb));   // 同行者（T19）：旅程檔 persons → 對得上的需求單（城市也對打包檔的 kb.city）→ 從 party 合成
  // 引擎不插的站：任何一天勾了的（含主行程；他勾的站由 picks 走）、任何一天按過「不去了」的（他拿掉的勾選站、拒絕過的引擎插站）（pickedOrRemoved）、
  // 前幾天已經插過的（同一家店不在兩天都被插）、走廊清單按過「我進去了」之後的日子（options.visited: { [poiId]: 'YYYY-MM-DD' }，裝置端 field.visited；
  // 原話 #138 去過的不再出現；進去那天本身照舊——visitedBefore）
  const pickedOrRemovedAnywhere = pickedOrRemoved(trip);
  const insertedSoFar = new Set();
  const shopping = shoppingDaysOf(trip, settings, warnings);   // 購物日欄位寫壞了記整趟警告、照樣排（總則 0）
  trip.days.forEach((d, index) => {
    const home = resolveHome(trip, d.date);
    const candidates = (d.picks ?? []).map((p) => {
      const poi = pois[p.poiId];
      if (!poi) { warnings.push({ code: 'pick-unknown', date: d.date, msg: `${d.date} 的 ${p.poiId} 不在知識庫` }); return null; }
      const fixedWindow = fixedWindowOf(p.fixedWindow, settings, warnings, d.date, poi);
      return { poi, priority: p.priority ?? 'want', dwellMin: p.dwellMin ?? fixedSpanMin(fixedWindow), fixedWindow, designated: (d.designated ?? []).includes(p.poiId), isAnchor: d.anchor?.poiId === p.poiId || Boolean(d.anchor?.poiIds?.includes(p.poiId)), errand: Boolean(p.errand), deferredFrom: p.deferredFrom ?? null };
    }).filter(Boolean);
    // 主行程：單站型用那站；主題型用骨架店的第一家當顯示名（畫面不得露出 theme 鍵值）
    const anchorPoi = d.anchor?.poiId ? pois[d.anchor.poiId] : (d.anchor?.poiIds?.length ? pois[d.anchor.poiIds[0]] : null);
    const themeCategory = themeCategoryOf(d, warnings);
    // fixed 日卻沒有任何一站帶固定時段（旅程檔手改漏了、或 fixedWindow 寫壞被拿掉）：那天會照營業時間當普通站排、整天像普通日，記整趟警告（10-14 T23 審查）
    if (d.type === 'fixed' && !candidates.some((c) => c.fixedWindow)) warnings.push({ code: 'fixed-day-no-window', date: d.date, msg: `${d.date} 標了固定時段日，但沒有一站帶固定時段（picks[].fixedWindow），會場會照營業時間當普通站排` });
    const win = dayWindow(d, index, settings, d.type === 'arrival' || d.type === 'departure' ? airportTransitMin({ legFn, home, settings }) : 0, country);
    for (const w of win.warnings) warnings.push({ ...w, date: d.date, msg: `${d.date} ${w.msg}` });
    // 那天在場的人與合併後的調整（T19）：party＝在場人數（有 dates 的只算那幾天；倍率那條照舊 ≥2 就 partyWalkFactor）；人之間取最鬆（原話 #144）
    const present = presentOn(persons, d.date);
    const adjust = mergeAdjustments(present);
    const day = {
      date: d.date, type: d.type ?? 'normal', earlyDay: Boolean(d.earlyDay), dayTrip: Boolean(d.dayTrip), party: present.length,
      persons: present, adjust,
      dayTripNext: prevType === 'daytrip' || Boolean(trip.days[index - 1]?.dayTrip),
      themeCategory, prevThemeCategory: prevTheme,
      anchorPoiId: anchorPoi?.id ?? null, anchorName: anchorPoi?.name_zh ?? d.anchor?.theme ?? null,
      designated: d.designated ?? [], regionZones: regionZonesOf({ home, candidates, anchorPoi }), homeZoneId: home?.zoneId ?? null,
      window: { startMin: win.startMin, endMin: win.endMin }, windowRaw: win.raw, openSlotMin: win.openSlotMin,
      openSlotSkipped: win.warnings.some((w) => w.code === 'open-slot-skipped'),
      taxRefundBufferMin: win.taxRefundBufferMin,   // 離境日真的扣掉的免稅緩衝（國家層 taxRefund，T20）；plan-report 與之後的離境日畫面讀，其餘日子 0
      // 夜間站：早起日前一晚、旅程檔手標、在場有人「不排」（adjust.nightSlot none）都不排；「少排」（less）那天 night-slot 的罰分減半（推導）
      nightSlotOff: Boolean(d.nightSlotOff) || Boolean(trip.days[index + 1]?.earlyDay) || adjust.nightSlot === 'none',
      nightSlotLess: adjust.nightSlot === 'less',
      // 購物日（原話 #36、#55；DESIGN §1.5）：規則 shopping-day 讀；非購物日 false／null
      shoppingDay: shopping.has(d.date), shoppingFromMin: shopping.get(d.date)?.fromMin ?? null,
    };
    // 只試排幾天（options.onlyDates）：其他日子不跑 planDay，plan 回 null；上下文與主題的傳遞照常
    if (onlyDates && !onlyDates.has(d.date)) {
      out.push({ date: d.date, day, plan: null });
      prevTheme = themeCategory; prevType = d.dayTrip ? 'daytrip' : (d.type ?? 'normal');
      return;
    }
    // 先照他勾的排；走路連跑破表（插恢復站）或等開門超過留白（填空檔）才把那種站加進候選重排一次，有比較好才採用。
    // 不每天都加：價值 0 的候選不受上界剪枝，試走包的 8/15 一加就從 276 節點變 6 萬節點、撞 800 ms 預算（2026-10-11 實測），結果還一樣。
    // 他拒絕過哪一種（原話 #126；profile §2.4「當天不再重插，連跑警告降成提示」）那天就不插那一種、它的觸發警告標 hint，畫面用提示樣式。
    const rejected = rejectedKinds(d.removed);
    // 他在這天換掉過的站（二選一選了 B 頂掉的 A、「換一家」換掉的）與二選一沒選、別天也排不進的那家（trip.deferred 裡 unplaced）：這天引擎不再把它當恢復站／填站插回來
    // （別天照舊可以——原話 #138 沒選的可以再出現；推導，T16；choices.js swappedAwayFrom）
    const exclude = new Set([...pickedOrRemovedAnywhere, ...insertedSoFar, ...visitedBefore(options.visited, d.date), ...swappedAwayFrom(trip, d.date)]);
    // 坐下來的地方（spot：海邊、公園、展望台）每天都進第一趟候選（optional、價值 0、最多 settings.spotPoolMax 家）：它的用處是把等固定時段的時間坐掉，
    // 第二趟才加會看不到（第一趟為了少等會跑去別區再回來）；拒絕過恢復站的那天不加（原話 #172 採的做法；10-16）；在場的人不想去的店型不拿（T19）
    const spots = rejected.has('rest') ? [] : restPool
      .filter((p) => p && p.category === 'spot' && engineMayInsert(p) && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id) && !personAvoids(day.adjust, p))
      .slice(0, settings.spotPoolMax ?? 2)
      .map((p) => ({ poi: p, priority: 'rest', optional: true, insertedBy: 'engine', dwellMin: p.dwellMin ?? 30 }));
    let plan = planDay({ candidates: [...candidates, ...spots], day, home, legFn, rules, settings, country, kb, options });
    const extra = extraCandidates({ restPool, candidates, day, exclude, home, plan, settings, rejected, legFn });
    if (extra.length) {
      const withExtra = planDay({ candidates: [...candidates, ...spots, ...extra], day, home, legFn, rules, settings, country, kb, options });
      if ((withExtra.complete && !plan.complete) || (withExtra.complete === plan.complete && withExtra.score > plan.score)) plan = withExtra;
    }
    // 順路站（原話 #170）：不進 DFS（價值 30 的候選會把節點吃爆，試走包兩天都撞 800 ms），改成貪婪插入——
    // 對排好的序列，每家候選試每個位置、整條重定時刻與重算分數，分數有變好、沒撞硬規則才收
    if (!(rejected.has('filler') || rejected.has('onway'))) {
      const onway = onTheWayCandidates({ restPool, day, exclude: new Set([...exclude, ...plan.sequence.map((s) => s.poi.id)]), home, plan, legFn, settings });
      plan = insertOnTheWay({ plan, onway, day, home, legFn, rules, settings, country, kb });
    }
    if (rejected.size) plan = { ...plan, warnings: plan.warnings.map((w) => (rejected.has(TRIGGER_KIND[w.ruleId]) ? { ...w, hint: true } : w)) };
    for (const s of plan.sequence) if (s.insertedBy) insertedSoFar.add(s.poi.id);
    // 順延過來的站（picks[].deferredFrom）這天排不進了：整趟警告、不罰；trip.deferred 那筆不自動改（DESIGN §6.3.2 寫的 toDate 回 null／status 'dropped' 沒做，只出警告）
    for (const c of candidates) {
      if (c.deferredFrom && plan.dropped.some((x) => x.poi.id === c.poi.id)) warnings.push({ code: 'deferred-dropped', date: d.date, poiId: c.poi.id, msg: `${c.poi.name_zh ?? c.poi.id} 從 ${monthDay(c.deferredFrom)} 順延到這天，但這天排不進了` });
    }
    // 他勾的站是在場的人不想去的店型（T19）：照排，那站多一條提示 person-avoid（hint、不罰、不進規則檔——跟 leg-suggest 同一種後處理）
    const avoidHints = personAvoidWarnings(plan.sequence, adjust);
    if (avoidHints.length) plan = { ...plan, warnings: [...(plan.warnings ?? []), ...avoidHints] };
    out.push({ date: d.date, day, plan });
    prevTheme = themeCategory; prevType = d.dayTrip ? 'daytrip' : (d.type ?? 'normal');
  });
  // 走廊清單與長段提示（T15）：七天都排完才算，掛在排好的序列旁，不進分數、不改時刻。exclude 比引擎插站多扣「任何一天引擎插過的站」（不只前幾天）：
  // 同一家店在別天是站就不當走廊——10-16 審查：仙台朝市早餐是 8/16 的引擎站卻列在 8/12、8/15 的走廊，8/12 按「升級」會把它變成 8/12 的站、8/16 就不插了。今天序列裡的站 corridorFor 自己扣。
  // 按過「我進去了」的（options.visited）從進去那天之後不再列（visitedBefore；原話 #138），進去那天照列、勾要看得到
  const sequences = out.map((x) => x.plan?.sequence ?? []);
  for (const x of out) if (x.plan) x.plan = attachCorridor({ plan: x.plan, home: resolveHome(trip, x.date), pool: restPool, legFn, settings, day: x.day, exclude: corridorExclude(trip, sequences, visitedBefore(options.visited, x.date)) });
  // 二選一（T16）：也是七天排完才算（exclude 要扣任何一天序列裡的站，含別天引擎插的：XXNT 是 8/15 的引擎站就不當 8/17 的 B；
  // 這天換掉過的與 unplaced 的 A 也不當這天的 B——swappedAwayFrom，10-16 審查）；不進分數與時刻
  const inAnySequence = new Set(sequences.flat().map((s) => s.poi.id));
  for (const x of out) if (x.plan) x.plan = { ...x.plan, choices: proposeChoices({ plan: x.plan, date: x.date, pool: restPool, legFn, settings, exclude: new Set([...pickedOrRemovedAnywhere, ...inAnySequence, ...visitedBefore(options.visited, x.date), ...swappedAwayFrom(trip, x.date)]) }) };
  return { days: out, warnings };
}

/** '2026-08-15' → '8/15'（整趟警告的人話；畫面另有 dom.js dateLabel）。 */
function monthDay(date) {
  const m = String(date ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : String(date ?? '');
}

/**
 * 第二趟要加進候選的引擎插站：第一趟有 walk-run 警告 → 恢復站（restCandidates）、有 wait-at-door 警告 → 填站（fillCandidates）；
 * rejected（這天拒絕過的種類 'rest'／'filler'）那一種不加；同一家店兩邊都選到只留恢復站那份（不綁空檔）。
 */
export function extraCandidates({ restPool = [], candidates = [], day, exclude = new Set(), home = null, plan, settings = {}, rejected = new Set(), legFn = null }) {
  const triggered = (ruleId) => (plan?.warnings ?? []).some((w) => w.ruleId === ruleId);
  const rests = triggered('walk-run') && !rejected.has('rest') ? restCandidates({ restPool, candidates, day, exclude, home, settings }) : [];
  // 填站與順路站都是「引擎多排一家店」：拒絕過其中一種，那天兩種都不插（推導；拒絕恢復站只管恢復站）
  const shopRejected = rejected.has('filler') || rejected.has('onway');
  const fillers = triggered('wait-at-door') && !shopRejected ? fillCandidates({ restPool, candidates, day, exclude, home, plan, settings, legFn }) : [];
  const seen = new Set(rests.map((c) => c.poi.id));
  return [...rests, ...fillers.filter((c) => (seen.has(c.poi.id) ? false : (seen.add(c.poi.id), true)))];
}

/**
 * 把順路站貪婪插進排好的序列：候選依繞路分鐘排序，每家試每個位置（整條重定時刻、重算整天分數），
 * 分數變好、沒有站撞硬規則才收；一天的引擎插站（含恢復站、填站）合計不超過 settings.restInsertMaxPerDay。
 */
export function insertOnTheWay({ plan, onway = [], day, home, legFn, rules, settings, country, kb }) {
  if (!onway.length || !plan?.sequence) return plan;
  const maxOptional = settings.restInsertMaxPerDay ?? 2;
  const evaluate = (sequence) => evaluateSequence({ sequence, day, home, legFn, rules, settings, country, kb });
  const waitSum = (s) => s.reduce((n, x) => n + (x.waitMin ?? 0), 0);
  const maxDetour = settings.onTheWayDetourMin ?? 8;
  const walkOnly = (leg) => leg && (leg.rideMin ?? 0) === 0 ? (leg.walkMin ?? 0) : null;
  let seq = plan.sequence; let best = evaluate(seq); let changed = false;
  for (const c of onway) {
    if (seq.filter((s) => s.optional).length >= maxOptional) break;
    const stop = { poi: c.poi, dwellMin: c.dwellMin, priority: c.priority, optional: true, insertedBy: 'engine', isAnchor: false, designated: false, fixedWindow: null, gap: null, errand: false, deferredFrom: null, detourMin: c.detourMin };
    // 只插在它真的順路的那一段（兩邊都走路、繞路 ≤ onTheWayDetourMin）：候選是看某一段算出來的，位置換了就不是順路
    // （10-13 七天實驗：8/15 BILLY'S ENT 被塞進兩段搭車之間、8/18 古著屋 JAM 被接在最後一站後面走回頭路）；最後一站之後沒有「下一站」，不插
    const onWayAt = (i) => {
      const prevPoi = i ? seq[i - 1].poi : home; const nextPoi = seq[i].poi;
      const direct = walkOnly(legFn(prevPoi, nextPoi)); const w1 = walkOnly(legFn(prevPoi, c.poi)); const w2 = walkOnly(legFn(c.poi, nextPoi));
      return direct != null && w1 != null && w2 != null && w1 + w2 - direct <= maxDetour;
    };
    let bestTrial = null;
    for (let i = 0; i < seq.length; i++) {
      if (!onWayAt(i)) continue;
      const trial = retimeSequence({ sequence: [...seq.slice(0, i), stop, ...seq.slice(i)], day, home, legFn, settings, country, kb });
      // 順路站自己不等開門，也不能害後面的站等：插在 11:00 才開的第一站前面，等於把「太晚出門」換成「在門口等 81 分」，
      // 分數上差不多、人卻站在門口（10-13 七天實驗 8/13）。填站同一條（原話 #164）。
      if ((trial[i].waitMin ?? 0) > 0 || waitSum(trial) > waitSum(seq)) continue;
      const ev = evaluate(trial);
      if (ev.breakdown.stops.some((s) => s.verdict !== 'ok')) continue;
      if (ev.score > best.score && (!bestTrial || ev.score > bestTrial.ev.score)) bestTrial = { trial, ev };
    }
    if (bestTrial) { seq = bestTrial.trial; best = bestTrial.ev; changed = true; }
  }
  if (!changed) return plan;
  return { ...plan, sequence: seq, score: best.score, penaltyMin: best.penaltyMin, warnings: best.warnings };
}

/**
 * 順路站（原話 #170：「如果有順路的話 直接就排行程進去就可以…主行程決定活動區域和路線 而不是決定當天的主題性」）：
 * 第一趟排出來的每一段走路（住宿→第一站也算），知識庫裡繞路 ≤ settings.onTheWayDetourMin（預設 8）分鐘的站就是順路——
 * 繞路＝走到它再走到下一站，比直接走多出的分鐘；搭車段不算順路。候選：先過 engineMayInsert（知識庫裡本來就不主動排的店不拿）、在當日區域、不在 exclude、
 * 不是交通／活動／錢湯／一日遊（NO_FILL_CATEGORIES）、不是購物類（SHOPPING_CATEGORIES：百貨、商店街、藥妝、電器、outlet——順路站只拿「為了逛而去」的店，
 * 原話 #170 舉的是「值得逛的古著店」、#20「順路的探店」、#82「經過古著店之類的服裝店或是店家的逛街行程」；「為了買而去」的店只走購物日（#36、#55）或順路購買（#29），
 * 10-13 七天實驗引擎把藥妝店、百貨當順路站塞了五次）、營業時間要有（不知道開不開的不插）；
 * 依繞路分鐘取最近 settings.onTheWayPoolMax（預設 4）家；價值 PRIORITY_VALUE.onway（預設 30，低於 maybe 的 45）、optional、insertedBy engine，
 * 站數、逛店連跑等規則照管；非主題日同類 ≤2 不管順路站（他 10-24 定：#170 順路站直接排先於 #123；rules/same-type-day.js、dim-cat-count.js），他不要就按「不去了」（記 priority 'onway'，那天不再插順路站）。
 */
export function onTheWayCandidates({ restPool = [], day, exclude = new Set(), home = null, plan, legFn, settings = {} }) {
  if (!restPool.length || !plan?.sequence?.length) return [];
  const maxDetour = settings.onTheWayDetourMin ?? 8;
  // 順路站是「值得逛」的店，不拿恢復站（咖啡廳、餐廳、酒吧由恢復站與填站的邏輯管）；在場的人不想去的店型不拿（T19）
  const pool = restPool.filter((p) => engineMayInsert(p) && !NO_FILL_CATEGORIES.has(p.category) && !SHOPPING_CATEGORIES.includes(p.category) && p.recovery !== true && p.hours && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id) && !personAvoids(day.adjust, p));
  if (!pool.length) return [];
  const walkOnly = (leg) => leg && (leg.rideMin ?? 0) === 0 ? (leg.walkMin ?? 0) : null;
  const stops = [home, ...plan.sequence.map((s) => s.poi)].filter(Boolean);
  const best = new Map();   // poiId → 最小繞路
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]; const b = stops[i + 1];
    const direct = walkOnly(legFn(a, b));
    if (direct == null) continue;
    for (const p of pool) {
      const w1 = walkOnly(legFn(a, p)); const w2 = walkOnly(legFn(p, b));
      if (w1 == null || w2 == null) continue;
      const detour = w1 + w2 - direct;
      if (detour <= maxDetour && detour < (best.get(p.id)?.detour ?? Infinity)) best.set(p.id, { p, detour });
    }
  }
  return [...best.values()].sort((x, y) => x.detour - y.detour).slice(0, settings.onTheWayPoolMax ?? 4)
    // 順路是看一下，不是待一下午：停留最多 onTheWayMaxDwellMin（預設 45；10-13 試走包把 135 分的商店街整條塞進 8/17）
    .map(({ p, detour }) => ({ poi: p, priority: 'onway', optional: true, insertedBy: 'engine', detourMin: detour, dwellMin: Math.min(p.dwellMin ?? settings.defaultDwellMin ?? 60, settings.onTheWayMaxDwellMin ?? 45) }));
}

/**
 * 走廊清單（原話 #57「在路程的旁邊塞我會經過的店家，讓我可以留意跟有個預期，如果我有進去我再從那裡面填寫我有進去」；DESIGN §1.9「走廊清單不是站」；T15）：
 * 排好的每一段走路（住宿→第一站也算；搭車段不算，人在車上經過什麼都進不去），知識庫裡離這段直線 ≤ settings.corridorListRadiusM（預設 100 m，DESIGN §4）的店。
 * 候選的門是 corridorEligible、不是引擎插站的 engineMayInsert（10-16 主控覆核：挖寶型、落選兩次、代購研究站都列，走廊清單正是被過濾掉的長尾回到他手上；只有他評 ≤2 星與 unlockWhen 未達的不列）、
 * 不是 NO_FILL_CATEGORIES（交通、活動、錢湯、一日遊、會場）、
 * 不是坐下來的地方（spot：他說的是「店家」，海邊、公園不是店；推導）、在當日區域、不在今天序列裡、不在 exclude（任何一天勾過、按過「不去了」的、任何一天引擎插過的、進去那天之後——corridorExclude）；沒座標的算不出距離、不列。
 * 經過那段的時間要開著（openIntervals；離開上一站→到下一站之間任一分鐘有開就算，出門那段用到第一站的時刻倒推走路分鐘）：午休、當天休息的不列
 * （10-16 審查：喜助 8/13 14:39–14:54 午休卻列在提示鍵裡、仙台朝市早餐 17:30 已關卻在現場頁「會經過」，升級還會落到「不在營業時間內」）；
 * 沒有營業時間資料的照列、標 open: null（畫面寫「營業時間沒查到」）；序列沒帶時刻（純幾何的呼叫）就只看當天有沒有營業。藏掉還是標「沒開」待確認，先藏。
 * 同一家店靠近兩段時歸離它最近、而且經過時有開的那段（相鄰兩段共用一站，不然站旁的店會在前後兩段各出現一次；推導，跟 fillCandidates 歸空檔同一種做法）。
 * 每段最多 settings.corridorListMaxPerLeg（預設 5）家，依離路線的距離近到遠（DESIGN §4 寫按 itemRank 排，品項命中還沒做，先用距離；推導）。
 * 回 [{ legIndex, pois: [{ poi, distM, open }] }]，legIndex 0＝住宿→第一站，沒店的段不列；不排時間、不算步行預算、不進分數——
 * 順路繞得進去又插得下的店已由順路站直接排（原話 #170），這裡是順路站不拿的（恢復站、購物類、沒營業時間；10-16 審查：仙台包 36 家走廊店 35 家繞路 ≤ 8 分）與插不下的（每日上限、分數沒變好）。
 */
export function corridorFor({ plan, home = null, pool = [], legFn, settings = {}, day, exclude = new Set() }) {
  const seq = plan?.sequence ?? [];
  if (!pool.length || !seq.length || !legFn) return [];
  const radius = settings.corridorListRadiusM ?? 100;
  const maxPerLeg = settings.corridorListMaxPerLeg ?? 5;
  const inSeq = new Set(seq.map((s) => s.poi.id));
  // 在場的人不想去的店型（day.adjust.avoidCategories，T19）也不列：清單是給他決定要不要進去的，但同行者已經說了不去
  const cands = pool.filter((p) => p && hasCoords(p) && corridorEligible(p) && !NO_FILL_CATEGORIES.has(p.category) && p.category !== 'spot' && (day?.regionZones ?? []).includes(p.zoneId) && !inSeq.has(p.id) && !exclude.has(p.id) && !personAvoids(day?.adjust, p));
  if (!cands.length) return [];
  const best = new Map();   // poiId → 離它最近、經過時有開的那段
  for (let i = 0; i < seq.length; i++) {
    const from = i === 0 ? home : seq[i - 1].poi; const to = seq[i].poi;
    if (!hasCoords(from) || !hasCoords(to)) continue;
    const leg = legFn(from, to);
    if (!leg || (leg.rideMin ?? 0) > 0) continue;
    // 經過這段的時間：離開上一站 → 到下一站（出門那段＝到第一站的時刻倒推走路分鐘）；序列沒帶時刻就是 NaN，openWhilePassing 只看當天有沒有營業
    const arriveMin = seq[i].arriveMin ?? seq[i].startMin;
    const leaveMin = i === 0 ? arriveMin - (leg.walkMin ?? 0) : seq[i - 1].endMin;
    for (const p of cands) {
      const distM = distToSegmentM(p, from, to);
      if (distM > radius || distM >= (best.get(p.id)?.distM ?? Infinity)) continue;
      const open = openWhilePassing(p, day?.date, leaveMin, arriveMin);
      if (open === false) continue;
      best.set(p.id, { poi: p, legIndex: i, distM, open });
    }
  }
  const byLeg = new Map();
  for (const hit of best.values()) byLeg.set(hit.legIndex, [...(byLeg.get(hit.legIndex) ?? []), hit]);
  const name = (p) => String(p.name_zh ?? p.id);
  return [...byLeg.keys()].sort((a, b) => a - b).map((legIndex) => ({
    legIndex,
    pois: byLeg.get(legIndex)
      .sort((a, b) => a.distM - b.distM || name(a.poi).localeCompare(name(b.poi)))
      .slice(0, maxPerLeg)
      .map(({ poi, distM, open }) => ({ poi, distM: Math.round(distM), open })),
  }));
}

/** 經過這段（leaveMin→arriveMin）時這家店開著嗎：true 有開、false 沒開（午休、當天休息）、null 沒有營業時間資料。沒給時刻（NaN）就只看當天有沒有營業；沒給日期算不出，當有開。 */
function openWhilePassing(poi, date, leaveMin, arriveMin) {
  if (!date) return poi?.hours ? true : null;
  const iv = openIntervals(poi, date);
  if (iv === null) return null;
  if (!Number.isFinite(leaveMin) || !Number.isFinite(arriveMin)) return iv.length > 0;
  return iv.some(([open, close]) => open <= arriveMin && close >= leaveMin);
}

/**
 * 把走廊清單掛上一天的 plan，順便出長段提示（DESIGN §5.2「長段可升級」；原話 #124「在路途中還有可挖掘的地點…有興趣的話，應該是可以升級成大站」、#101）：
 * 一段走路 ≥ settings.legSuggestMin（預設 10）分、而且那段走廊清單有店 → plan.warnings 多一條 { ruleId: 'leg-suggest', code: 'hint', hint: true, legIndex, walkMin, msg }。
 * 純提示：不罰、不自動插（profile §2.4「長移動段只提示、不自動提站」），升級是他按的（規劃頁那段的鍵 → app.js upgradeCorridor）。
 * 放這裡當後處理、不進規則檔：它不影響搜尋與分數。DESIGN §5.2 寫的「兩個恢復站之間」是它的特例——沒店可升級的長段不提示（提示了也沒東西可按；推導）；
 * 「時間軸空檔 > 留白」那種等開門已有 wait-at-door，不重複出。
 * 回新的 plan：corridor 掛上、提示加進 warnings；sequence、score、penaltyMin、時刻都不動。現場套過改案的序列也走這裡重算（applied.js appliedPlan）。
 */
export function attachCorridor({ plan, home = null, pool = [], legFn, settings = {}, day, exclude = new Set() }) {
  const corridor = corridorFor({ plan, home, pool, legFn, settings, day, exclude });
  const minWalk = settings.legSuggestMin ?? 10;
  const hints = [];
  for (const c of corridor) {
    const from = c.legIndex === 0 ? home : plan.sequence[c.legIndex - 1].poi; const to = plan.sequence[c.legIndex].poi;
    const walkMin = legFn(from, to)?.walkMin ?? 0;
    if (walkMin < minWalk) continue;
    const names = c.pois.slice(0, 3).map((x) => x.poi.name_zh ?? x.poi.id).join('、');
    const more = c.pois.length > 3 ? ` 等 ${c.pois.length} 家` : '';
    hints.push({ ruleId: 'leg-suggest', code: 'hint', hint: true, legIndex: c.legIndex, walkMin, msg: `${from?.name_zh ?? '住宿'}→${to.name_zh ?? to.id} 這段走 ${walkMin} 分，經過 ${names}${more}，可升級成站` });
  }
  return { ...plan, corridor, warnings: hints.length ? [...(plan.warnings ?? []), ...hints] : (plan.warnings ?? []) };
}

/**
 * 走廊清單不列的站：任何一天勾過／拒絕過的（pickedOrRemoved）∪ 任何一天引擎插過的（sequences 裡 insertedBy 的站；同一家店在別天是站就不當走廊，不只前幾天）
 * ∪ visitedIds（那天之前按過「我進去了」的，呼叫端用 visitedBefore 算）。
 * planTrip 每天算一次、現場改案重算（applied.js appliedPlan）共用；今天序列裡的站 corridorFor 自己扣，不用放進來。
 */
export function corridorExclude(trip, sequences = [], visitedIds = []) {
  const out = pickedOrRemoved(trip);
  for (const seq of sequences) for (const s of seq ?? []) if (s?.insertedBy && s.poi?.id) out.add(s.poi.id);
  for (const id of visitedIds ?? []) if (id) out.add(id);
  return out;
}

/**
 * 按過「我進去了」之後的日子不再出現（原話 #138「如果前面已經去過，怎麼還會再次出現？有出現但我沒選擇，還是可以再次出現」）：
 * visited 是 { [poiId]: 'YYYY-MM-DD' }（裝置端 field.visited 的日期，ui/corridor.js visitedDates 轉的），回 date 之前去過的店 id；
 * 進去那天本身不算（那天的走廊清單上要看得到勾）。引擎插站的 exclude 與走廊清單都吃這份；他自己勾的 picks 不受影響。
 */
export function visitedBefore(visited = {}, date = '') {
  return Object.entries(visited ?? {}).filter(([, on]) => typeof on === 'string' && on < date).map(([id]) => id);
}

/** 引擎不插、走廊清單也不列的站：任何一天勾了的（含主行程；他勾的站由 picks 走）、任何一天按過「不去了」的（他拿掉的勾選站、拒絕過的引擎插站）。planTrip 與現場套改案後重算（applied.js）共用。 */
export function pickedOrRemoved(trip) {
  const days = trip?.days ?? [];
  const picked = days.flatMap((d) => [...(d.picks ?? []).map((p) => p.poiId), d.anchor?.poiId, ...(d.anchor?.poiIds ?? [])]);
  const removed = days.flatMap((d) => (d.removed ?? []).map((r) => r?.poiId));
  return new Set([...picked, ...removed].filter(Boolean));
}

/**
 * 引擎可插的恢復站（DESIGN §1.3：走路連跑要破 150 才由引擎插恢復站，來源＝候選池未勾 ∪ 當日區域 KB，標引擎插的、可拒絕）。
 * restPool 裡 recovery 的站、先過 engineMayInsert（知識庫裡本來就不主動排的店不拿）、在當日區域內、不在 exclude 裡（任何一天勾的、按過不去了的、前幾天插過的）；
 * 依到當天 picks 座標重心的直線距離取最近的 settings.restPoolMax 家（picks 都沒座標就以住宿為中心；沒座標的站排最後）。
 * 價值 0（priority 'rest'）、optional：排不進不算落選；排進去的 stop 帶 insertedBy: 'engine'，畫面上「不去了」就進 removed。
 */
export function restCandidates({ restPool = [], candidates = [], day, exclude = new Set(), home = null, settings = {} }) {
  if (!restPool.length) return [];
  const center = centroidOf(candidates.map((c) => c.poi)) ?? (hasCoords(home) ? { lat: home.lat, lng: home.lng } : null);
  const distance = (p) => (center && hasCoords(p) ? haversineM(center, p) : Infinity);
  return restPool
    // 錢湯／日歸溫泉要準備（毛巾、換洗，profile §5.9），引擎不自己插；他勾了才會在 picks 裡；在場的人不想去的店型不拿（T19）
    .filter((p) => engineMayInsert(p) && p.recovery === true && p.category !== 'onsen' && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id) && !personAvoids(day.adjust, p))
    .map((p) => ({ p, d: distance(p) }))
    .sort((a, b) => (a.d === b.d ? 0 : a.d < b.d ? -1 : 1))
    .slice(0, settings.restPoolMax ?? 6)
    .map(({ p }) => ({ poi: p, priority: 'rest', optional: true, insertedBy: 'engine', dwellMin: p.dwellMin ?? Math.max(settings.restResetMin ?? 30, 30) }));
}

/**
 * 填等開門空檔的候選（原話 #161「任何站都可以」；他答的是「等開門的空檔」，所以填站綁在那段空檔內）。
 * 每個等開門警告（帶 poiId）算出那段空檔 gap：前一站結束 → 等開門那站的開門時刻；太晚出門的警告也算（2026-10-12 對抗審查：第一站永遠不會等開門，
 * 早上的空檔只能靠這條觸發）：gap＝時窗起點 → 第一站開門，中點取住宿與第一站
 * （openIntervals 找到達後第一個營業區間的開門；沒有結構化時段就用它排定的開始時刻）；不到 settings.fillMinGapMin（預設 15）分的空檔不填。
 * 候選：restPool 裡先過 engineMayInsert（知識庫裡本來就不主動排的店不拿）、不是交通、活動、錢湯、一日遊的站（NO_FILL_CATEGORIES；店型不另限，原話 #161「任何站都可以」——
 * 購物類填在非購物日由規則 shopping-day 罰掉，購物日照填），在當日區域內、不在 exclude 裡（任何一天勾的、按過不去了的、前幾天插過的）、
 * 空檔開始時就已經開門（原話 #164：填站不能自己再等一次開門；沒有結構化時段視為有開；當天休息跳過），沒開的不佔 fillPoolMax 名額；
 * 依到「等開門那站與它前一站（沒有就住宿）中點」的直線距離取最近 settings.fillPoolMax 家。
 * 等的那站前面整塊能往後挪時（搭車過來的那一塊，受各站關門時刻限制），鬆弛算成搭車前、上一區的空檔，填站也可以放那裡（upstreamGap，T24）。
 * 候選帶 gap（規則 filler-gap 擋在空檔外的排法）與 dwellMin = min(店的停留, 空檔長度 − fillMinGapMin)（留給兩段移動），裁完不到 fillMinGapMin 的不拿、不佔名額；
 * 價值 0（priority 'filler'）、optional、insertedBy 'engine'，可拒絕。
 * 同一家店靠近兩段空檔時歸離它比較近的那段。
 */
export function fillCandidates({ restPool = [], candidates = [], day, exclude = new Set(), home = null, plan, settings = {}, legFn = null }) {
  if (!restPool.length || !plan?.sequence?.length) return [];
  const pool = restPool.filter((p) => engineMayInsert(p) && !NO_FILL_CATEGORIES.has(p.category) && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id) && !personAvoids(day.adjust, p));   // 在場的人不想去的店型不拿（T19）
  const out = new Map();
  const minGap = settings.fillMinGapMin ?? 15;
  // 一段空檔 → 離它最近、開始時有開的幾家店；同一家店靠近兩段空檔時歸離它比較近的那段（城裡的店不該綁在松島那段空檔裡，T24）
  const addGap = (gap, mid) => {
    const gapMin = gap.endMin - gap.startMin;
    if (gapMin < minGap) return;
    const distance = (p) => (mid && hasCoords(p) ? haversineM(mid, p) : Infinity);
    pool.filter((p) => openFrom(p, day.date, gap.startMin, minGap))
      .map((p) => ({ p, d: distance(p) })).sort((a, b) => (a.d === b.d ? 0 : a.d < b.d ? -1 : 1)).slice(0, settings.fillPoolMax ?? 6)
      .forEach(({ p, d }) => {
        const prev = out.get(p.id);
        if (prev && prev.d <= d) return;
        const dwellMin = Math.min(p.dwellMin ?? settings.defaultDwellMin ?? 60, gapMin - minGap);
        if (dwellMin < minGap) return;
        out.set(p.id, { poi: p, priority: 'filler', optional: true, insertedBy: 'engine', gap, dwellMin, d });
      });
  };
  for (const w of plan.warnings.filter((x) => (x.ruleId === 'wait-at-door' || x.ruleId === 'late-departure') && x.poiId)) {
    const i = plan.sequence.findIndex((s) => s.poi.id === w.poiId);
    if (i < 0) continue;
    const waiting = plan.sequence[i]; const before = i > 0 ? plan.sequence[i - 1] : null;
    const gap = { startMin: before ? before.endMin : day.window.startMin, endMin: opensAt(waiting, day.date) };
    const mid = centroidOf([waiting.poi, before?.poi ?? home].filter(Boolean)) ?? centroidOf(candidates.map((c) => c.poi));
    addGap(gap, mid);
    // 錨點前的空檔倒推（T24，DESIGN §1.2「提早多久到錨點區＝錨點時限＋錨點區當天有開的候選夠不夠逛」、原話 #80「一大早到松島…逛無可逛」）：
    // 等的那站前面、搭車過來之後的整塊能往後挪多少，那段鬆弛就是搭車前、上一區的空檔——填站可以放那裡（城裡有的是店），
    // 搭車自然延後、整塊跟著往後貼、等的時間變短。10-13 七天實驗 8/16：松島的站 16:35 就用完、花火 18:30，空等 115 分，而仙台午餐後的空檔沒人填。
    const up = legFn ? upstreamGap({ sequence: plan.sequence, index: i, day, legFn, home }) : null;
    if (up) addGap(up.gap, hasCoords(up.near) ? { lat: up.near.lat, lng: up.near.lng } : mid);
  }
  return [...out.values()].map(({ d, ...c }) => c);
}

/**
 * 等的那站（index）前面、搭車過來之後連續走路到得了的那一塊（block）能往後挪多少（T24）：
 * 鬆弛 ＝ min(等的分鐘, block 裡「所在營業區間的關門時刻 − 它的結束」的最大值)——取最大值是樂觀估計，讓第二趟搜尋可以把 block 重排（先去早關門的那家）；
 * 排不開的硬規則 hours 會擋，填站是 optional，排不進就不插。block 前面要是搭車段（鬆弛在同一區時原本的空檔已經涵蓋）；block 裡有固定時段的站就不挪；
 * 沒結構化時段的站不設限。回 { gap: { startMin: 搭車前那站的結束（沒有就時窗起點）, endMin: 同＋鬆弛 }, near: 搭車前那站（沒有就住宿） }，沒有可挪的塊回 null。
 */
export function upstreamGap({ sequence, index, day, legFn, home }) {
  if (!Array.isArray(sequence) || index <= 0 || index >= sequence.length) return null;
  let start = index;
  for (let k = index - 1; k >= 0; k--) {
    const prevPoi = k > 0 ? sequence[k - 1].poi : home;
    start = k;
    if ((legFn(prevPoi, sequence[k].poi)?.rideMin ?? 0) > 0) break;
  }
  if (start >= index) return null;
  const beforeBlock = start > 0 ? sequence[start - 1].poi : home;
  if ((legFn(beforeBlock, sequence[start].poi)?.rideMin ?? 0) <= 0) return null;
  const waiting = sequence[index];
  let roomMax = 0;
  for (let k = start; k < index; k++) {
    const s = sequence[k];
    if (s.fixedWindow) return null;
    const intervals = openIntervals(s.poi, day.date);
    if (!intervals || !intervals.length) { roomMax = Infinity; continue; }
    const cur = intervals.find(([o, c]) => s.startMin >= o && s.startMin < c) ?? intervals.find(([, c]) => s.endMin <= c);
    if (!cur) continue;
    roomMax = Math.max(roomMax, cur[1] - s.endMin);
  }
  const slack = Math.min(waiting.waitMin ?? 0, roomMax);
  if (!(slack > 0)) return null;
  const prevStop = start > 0 ? sequence[start - 1] : null;
  const gapStart = prevStop ? prevStop.endMin : day.window.startMin;
  return { gap: { startMin: gapStart, endMin: gapStart + slack }, near: prevStop?.poi ?? home };
}

// 填空檔不拿的店型（推導；原話只說「任何站都可以」）：交通與資訊（不是地點）、活動（綁日期）、錢湯（要準備，profile §5.9）、
// 一日遊的複合條目（daytrip：「松島（遊覽船＋瑞巖寺＋圓通院）」那種是研究摘要，不是一個地點；10-13 七天實驗 8/14 引擎把「鹽竈（神社＋壽司）」當站插進去）、
// 會場（venue：研討會、演唱會的場地，只有旅程檔那天勾了它、帶 fixedWindow 才有意義；知識庫的營業時間寫的是那天的時段卻解析成七天都開，
// 不擋的話 8/13 等開門的空檔會把研討會會場當 60 分的填站插進去——10-14 T23 審查）。順路站的池同一張。
const NO_FILL_CATEGORIES = new Set(['logistics', 'event', 'onsen', 'daytrip', 'venue']);

/**
 * 引擎自己插的站（恢復站、填站、順路站三個池，與現場「累了」的池）共用的門：知識庫裡本來就不主動排的店不拿——
 * - curated === false：已確認挖寶型（總則 2「選品店優先，挖寶型排除」；profile §5.12 只允許手填 false；Second Street／JAM／Florida 09-07 文件測試已判不進）
 * - my.rating ≤ 2：「不會再去」「踩雷」，不主動排（profile §7 星等表）
 * - poolLosses ≥ 2：候選池落選兩次降權，排程不主動排（profile §7、原話 #89）
 * - unlockWhen 有值：「下次再說」層，未達條件不排（profile §7；善治郎那種）
 * - item 有值：代購研究的站是為了買某樣東西才查的，順路購買由代購清單管（原話 #87、#29；10-13 七天實驗引擎把「藤崎 香氛區（查證結果：未見 DKNY，可略過）」當站塞進 8/17）
 * 他自己勾的站不走這裡（picks 照排，總則 3「指定行程凌駕偏好」）。10-14 T22。
 * 10-14 現況（審查後註記）：仙台包 147 站的 my 都是 {}、沒有一筆 poolLosses 或 unlockWhen（§7 點名的善治郎也沒標），src/ui 也還沒把評分寫進 poi.my（field.ratings 留在手機裡）；
 * 今天真的擋到東西的只有 curated:false 與 item 兩條，其餘三條是門先立著、等資料接上。
 */
export function engineMayInsert(p) {
  if (!p) return false;
  if (p.curated === false) return false;
  if (Number.isFinite(p.my?.rating) && p.my.rating <= 2) return false;
  if ((p.poolLosses ?? 0) >= 2) return false;
  if (p.unlockWhen) return false;
  if (p.item) return false;
  return true;
}

/**
 * 走廊清單的門（T15，10-16 主控覆核）：跟 engineMayInsert 不同——走廊清單正是「被系統過濾掉的店以『你自己決定要不要進去』的形式回到手上」
 * （profile §8 走廊清單；DESIGN §4 poolLosses ≥2「排程不主動排（只進走廊清單）」；知識庫 Second Street／JAM／Florida／What'z up 的 _curated說明「留在知識庫給走廊清單與他自己勾」），
 * 所以挖寶型（curated:false）、落選兩次（poolLosses ≥2）、代購研究站（item；DESIGN §4 走廊按 itemRank 排，品項落點本來就該在走廊上）都列。
 * 不列的只有他自己鎖掉的：評過 ≤2 星（「不會再去」「踩雷」，profile §7）與 unlockWhen 未達（「下次再說」層）。實作代理原本借用 engineMayInsert，跟上面三處文件相反，10-16 改回。
 */
export function corridorEligible(p) {
  if (!p) return false;
  if (Number.isFinite(p.my?.rating) && p.my.rating <= 2) return false;
  if (p.unlockWhen) return false;
  return true;
}

/**
 * 購物日：shoppingDaysOf(trip, settings, warnings?) → Map<date, { shoppingDay: true, fromMin: number|null }>（fromMin 有值＝那天從幾分起才是購物時段）。
 * trip.shoppingDays 有值（陣列，元素 'YYYY-MM-DD' 或 { date, fromHM }）就照它（空陣列＝這趟沒有購物日）；
 * 沒有就照完整天數推（DESIGN §1.5、profile §5.10 原話 #36「出國的倒數一兩天才是購物行程」；門檻是 DESIGN 09-02 定的，預設等級）：
 * 完整天數 N＝type 不是 arrival／departure 的天數；N ≤ 2 → 只有離境日；N = 3 → 離境日＋前一天從 settings.shoppingAfternoonHM（預設 '13:00'）起；
 * N ≥ 4 → 含離境日的最後兩天整天。沒有 departure 日就拿最後一天當離境日。仙台那趟 7 天（N = 5）＝ 8/17 全天＋8/18。
 * 壞輸入不丟錯（總則 0「永遠回得出東西」；跟 planTrip 對 pick-unknown 的處理同一種，10-14 審查後改）：這些是他會手改的欄位，記進 warnings（planTrip 的整趟警告陣列，可不給）就好——
 * trip.shoppingDays 不是陣列 → shopping-days-bad、照天數推；fromHM 或 settings.shoppingAfternoonHM 不是 HH:MM → shopping-from-bad、那天當整天購物日。
 */
export function shoppingDaysOf(trip, settings = {}, warnings = null) {
  const out = new Map();
  const days = trip?.days ?? [];
  const warn = (w) => { if (Array.isArray(warnings)) warnings.push(w); };
  const given = trip?.shoppingDays;
  if (Array.isArray(given)) {
    for (const entry of given) {
      const date = typeof entry === 'string' ? entry : entry?.date;
      if (!date) { warn({ code: 'shopping-days-bad', msg: '購物日清單裡有一筆沒有日期，跳過它' }); continue; }
      const fromHM = entry && typeof entry === 'object' ? entry.fromHM ?? null : null;
      const fromMin = fromHM ? safeHmToMin(fromHM) : null;
      if (fromHM && fromMin == null) warn({ code: 'shopping-from-bad', date, msg: `${date} 的購物時段起點「${fromHM}」看不懂（要寫成 HH:MM），那天當整天購物日` });
      out.set(date, { shoppingDay: true, fromMin });
    }
    return out;
  }
  if (given != null) warn({ code: 'shopping-days-bad', msg: '購物日覆寫要是日期清單（旅程檔的 shoppingDays 不是陣列），先照天數自動推' });
  if (!days.length) return out;
  const full = days.filter((d) => d.type !== 'arrival' && d.type !== 'departure').length;
  let dep = days.length - 1;
  for (let i = days.length - 1; i >= 0; i--) if (days[i].type === 'departure') { dep = i; break; }
  out.set(days[dep].date, { shoppingDay: true, fromMin: null });
  if (dep >= 1 && full === 3) {
    const hm = settings.shoppingAfternoonHM ?? '13:00';
    const fromMin = safeHmToMin(hm);
    if (fromMin == null) warn({ code: 'shopping-from-bad', date: days[dep - 1].date, msg: `設定的購物日下午起點「${hm}」看不懂（要寫成 HH:MM），${days[dep - 1].date} 當整天購物日` });
    out.set(days[dep - 1].date, { shoppingDay: true, fromMin });
  } else if (dep >= 1 && full >= 4) out.set(days[dep - 1].date, { shoppingDay: true, fromMin: null });
  return out;
}

/** 'HH:MM' → 分鐘；格式不對回 null（hmToMin 會丟錯；這裡只給他會手改的購物日欄位用，時窗那些照舊丟）。 */
function safeHmToMin(hm) { try { return hmToMin(hm); } catch { return null; } }

/**
 * 旅程檔 picks[].fixedWindow 補齊預設（DESIGN §11.1 Q7「固定時段前 40 後 30 不排站」；10-14 T23）→ 新物件，沒有固定時段回 null。
 * - arriveEarlyMin 缺就用 settings.fixedBeforeMin（預設 40；數字出自 08-19 計畫 1 第 2159 行的夾具 arriveEarlyMin: 40／afterMin: 30 與 DESIGN Q7，預設等級。
 *   知識庫 8/14 研討會通勤條目的「建議研討會開始前 40 分出門」講的是出門時刻、門到門 25–30 分，不是到場提前量，不當出處——10-14 T23 審查）
 * - 有 endMin 而 afterMin 缺就用 settings.fixedAfterMin（預設 30）；沒有 endMin 的（花火那種只釘開始時刻）不補 afterMin，結束照停留算（schedule.js placeStop）
 * - 寫壞了（不是物件、startMin 不是分鐘數、endMin 早於開始、提前量或散場緩衝是負數）當沒有固定時段、記整趟警告 fixed-window-bad（總則 0；跟 shoppingDaysOf 的 shopping-days-bad 同一種處理，warnings 可不給）——
 *   不擋的話 placeStop 會算出 NaN 的時刻、或卡位時刻跑到開始之後、整天靜靜地壞掉
 */
export function fixedWindowOf(raw, settings = {}, warnings = null, date = null, poi = null) {
  if (raw == null) return null;
  const bad = (why) => {
    if (Array.isArray(warnings)) warnings.push({ code: 'fixed-window-bad', date, poiId: poi?.id ?? null, msg: `${date ?? ''} 的 ${poi?.name_zh ?? poi?.id ?? '這一站'} 的固定時段${why}，當沒有固定時段排`.trim() });
    return null;
  };
  if (typeof raw !== 'object' || !Number.isFinite(raw.startMin)) return bad('看不懂（startMin 要是從 0:00 起算的分鐘數）');
  const hasEnd = raw.endMin != null;
  if (hasEnd && !(Number.isFinite(raw.endMin) && raw.endMin >= raw.startMin)) return bad('的結束比開始早、或不是分鐘數');
  if ((raw.arriveEarlyMin != null && !(Number.isFinite(raw.arriveEarlyMin) && raw.arriveEarlyMin >= 0)) || (raw.afterMin != null && !(Number.isFinite(raw.afterMin) && raw.afterMin >= 0))) return bad('的提前量或散場緩衝不是 0 以上的分鐘數');
  const out = { ...raw, arriveEarlyMin: Number.isFinite(raw.arriveEarlyMin) ? raw.arriveEarlyMin : (settings.fixedBeforeMin ?? 40) };
  if (hasEnd) out.afterMin = Number.isFinite(raw.afterMin) ? raw.afterMin : (settings.fixedAfterMin ?? 30);
  return out;
}

/** 有起訖的固定時段釘住的整段分鐘（卡位提前量＋時段＋散場緩衝）；只釘開始的回 undefined（停留照 picks 或知識庫）。 */
export function fixedSpanMin(fw) {
  if (!fw || !Number.isFinite(fw.endMin)) return undefined;
  return (fw.endMin + (fw.afterMin ?? 0)) - (fw.startMin - (fw.arriveEarlyMin ?? 0));
}

/**
 * 主題日的店型：themeCategoryOf(day, warnings?) → 店型鍵或 null（沒有主題、或主題看不出是哪一類店）。
 * 來源是旅程檔 days[].anchor.theme（需求單 §1 骨架表的主題日欄，規劃者寫進旅程檔；DESIGN §4）。合法值是店型鍵（vintage／record／cafe 這種，src/data/schema.js CATEGORIES）；
 * 寫成需求單上的中文（古著／唱片行／咖啡廳）就照知識庫店型的對照表翻（derive/category.json，跟 normalizePoi 認店型同一張）；
 * 翻不出來記整趟警告 theme-unknown、那天當普通日排（同類 ≤2 照管）——不這樣的話畫面會寫「XX主題日」、引擎卻照普通日排、落選理由還寫同類上限（10-14 T25 審查）。
 * 壞輸入不丟錯（總則 0），跟 shoppingDaysOf 同一種處理；warnings 可不給。
 */
export function themeCategoryOf(day, warnings = null) {
  const raw = day?.anchor?.theme;
  if (raw == null || raw === '') return null;
  if (CATEGORIES.includes(raw)) return raw;
  const { key } = classifyCategory(raw);
  if (key !== 'other') return key;
  if (Array.isArray(warnings)) warnings.push({ code: 'theme-unknown', date: day.date, msg: `${day.date} 的主題「${raw}」看不出是哪一類店（寫古著、唱片行、咖啡廳這種類別），那天當普通日排` });
  return null;
}

/** 等開門那站的開門時刻：到達後第一個營業區間的開門；拿不到（沒有結構化時段、或那個區間其實已經開了）就用它排定的開始時刻。 */
function opensAt(stop, date) {
  const open = openIntervals(stop.poi, date)?.find(([, close]) => stop.arriveMin < close)?.[0];
  return open != null && open > stop.arriveMin ? open : stop.startMin;
}

/** 這家店在空檔開始時就已經開門、而且至少再開 minGap 分：填站自己不能再等一次開門（原話 #164「禁」）。沒有結構化時段視為有開；當天休息沒開。 */
function openFrom(poi, date, atMin, minGap) {
  const intervals = openIntervals(poi, date);
  if (intervals === null) return true;
  return intervals.some(([open, close]) => open <= atMin && close >= atMin + minGap);
}

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/** 這天拒絕過哪幾種引擎插的站（規劃頁「不去了」把 stop.insertedBy 與 priority 記進 removed）；舊資料沒記 priority 的當恢復站。 */
function rejectedKinds(removed = []) {
  const kinds = new Set();
  for (const r of removed) if (r?.insertedBy === 'engine') kinds.add(r.priority === 'filler' || r.priority === 'onway' ? r.priority : 'rest');
  return kinds;
}

/** 有座標的站的重心；一個都沒有回 null。 */
function centroidOf(list) {
  const pts = list.filter(hasCoords);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

export function resolveHome(trip, date) {
  const bases = trip.homeBases ?? [];
  const hit = bases.find((b) => (!b.fromDate || b.fromDate <= date) && (!b.toDate || date <= b.toDate)) ?? bases[0];
  return hit?.poi ?? { id: 'home', name_zh: '住宿', zoneId: null };
}
