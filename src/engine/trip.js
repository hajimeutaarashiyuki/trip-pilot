// 整趟：把旅程的每一天交給 planDay（第一版：分天是他在規劃頁點的，引擎只排單日；決策樹 Q7）。
// 這裡負責把 Trip／Day 的資料翻成 planDay 要的 day 上下文：時窗、早起日、晚出門、一日遊、主題、主行程、指定站、當日區域。
import { planDay } from './core.js';
import { hmToMin, openIntervals, overlapMin } from './time.js';
import { haversineM } from '../geo/matrix.js';
import { evaluateSequence, retimeSequence } from './sequence.js';
import { SHOPPING_CATEGORIES } from '../rules/_helpers.js';   // 只借購物類店型清單篩順路站，不是規則邏輯（規則在 rules/shopping-day.js）
import { CATEGORIES, classifyCategory } from '../data/schema.js';   // 主題日的店型要對得上知識庫的店型（themeCategoryOf）

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
 * 留白從時窗尾端扣（profile §8「每天留 90 分鐘」、DESIGN §4 days[].openSlotMin）：每天的落後額度 day.openSlotMin ?? settings.openSlotMinPerDay，
 * 排程時從收工時刻扣掉＝排在最後；departure 日一律 0（那天的尾端是飛機）。
 * 扣完整天只剩 settings.openSlotSkipBelowMin（預設 60）分或更少就不扣、記警告 open-slot-skipped（推導：抵達日很晚落地那種，扣了就沒得排）。
 * 回 { startMin, endMin（扣過的收工時刻，硬規則 window 看這個）, raw: { startMin, endMin }（原時窗，給畫面與夜間站）, openSlotMin（真的扣掉的分鐘）, warnings }
 */
export function dayWindow(day, index, settings, airportTransit = 0) {
  const [start, end] = (settings.dayWindow ?? ['09:00', '24:00']).map(hmToMin);
  let startMin = start;
  if (day.earlyDay && day.departHM) startMin = hmToMin(day.departHM);
  else if (!day.earlyDay && day.type === 'normal' && index + 1 >= (settings.lateStartFromDay ?? 3) && !day.dayTrip) startMin = hmToMin(settings.lateStartHM ?? '11:00');
  if (day.type === 'arrival' && day.arriveMin != null) startMin = Math.max(startMin, day.arriveMin + (settings.arrivalBufferMin ?? 60) + airportTransit);
  let endMin = end;
  if (day.type === 'departure' && day.departAirportMin != null) endMin = Math.min(endMin, day.departAirportMin - (settings.departureBufferMin ?? 180) - airportTransit);
  const raw = { startMin, endMin };
  const wanted = day.type === 'departure' ? 0 : Math.max(0, Number(day.openSlotMin ?? settings.openSlotMinPerDay ?? 90) || 0);
  const warnings = [];
  let openSlotMin = wanted;
  if (wanted > 0 && endMin - wanted <= startMin + (settings.openSlotSkipBelowMin ?? 60)) {
    openSlotMin = 0;
    warnings.push({ code: 'open-slot-skipped', msg: `時窗只有 ${endMin - startMin} 分鐘，留白 ${wanted} 分沒從時窗扣` });
  }
  return { startMin, endMin: endMin - openSlotMin, raw, openSlotMin, warnings };
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
 *   shoppingDay（這天是不是購物日）、shoppingFromMin（購物時段從幾分起，整天都是就 null；非購物日 false／null）
 * - pois：{ [poiId]: poi }（已 normalize）
 * - restPool：引擎可插的站的來源（已規範化的 POI 陣列，可空；畫面與報告傳整個知識庫），每天由 restCandidates（恢復站）、fillCandidates（填空檔）、onTheWayCandidates（順路站）篩，三個池都先過 engineMayInsert
 */
export function planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool = [], options = {} }) {
  const out = []; const warnings = [];
  let prevTheme = null; let prevType = null;
  // 引擎不插的站：任何一天勾了的（含主行程；他勾的站由 picks 走）、任何一天按過「不去了」的（他拿掉的勾選站、拒絕過的引擎插站）、
  // 前幾天已經插過的（同一家店不在兩天都被插）
  const pickedAnywhere = new Set(trip.days.flatMap((d) => [...(d.picks ?? []).map((p) => p.poiId), d.anchor?.poiId, ...(d.anchor?.poiIds ?? [])]).filter(Boolean));
  const removedAnywhere = new Set(trip.days.flatMap((d) => (d.removed ?? []).map((r) => r?.poiId)).filter(Boolean));
  const insertedSoFar = new Set();
  const shopping = shoppingDaysOf(trip, settings, warnings);   // 購物日欄位寫壞了記整趟警告、照樣排（總則 0）
  trip.days.forEach((d, index) => {
    const home = resolveHome(trip, d.date);
    const candidates = (d.picks ?? []).map((p) => {
      const poi = pois[p.poiId];
      if (!poi) { warnings.push({ code: 'pick-unknown', date: d.date, msg: `${d.date} 的 ${p.poiId} 不在知識庫` }); return null; }
      const fixedWindow = fixedWindowOf(p.fixedWindow, settings, warnings, d.date, poi);
      return { poi, priority: p.priority ?? 'want', dwellMin: p.dwellMin ?? fixedSpanMin(fixedWindow), fixedWindow, designated: (d.designated ?? []).includes(p.poiId), isAnchor: d.anchor?.poiId === p.poiId || Boolean(d.anchor?.poiIds?.includes(p.poiId)), errand: Boolean(p.errand) };
    }).filter(Boolean);
    // 主行程：單站型用那站；主題型用骨架店的第一家當顯示名（畫面不得露出 theme 鍵值）
    const anchorPoi = d.anchor?.poiId ? pois[d.anchor.poiId] : (d.anchor?.poiIds?.length ? pois[d.anchor.poiIds[0]] : null);
    const themeCategory = themeCategoryOf(d, warnings);
    // fixed 日卻沒有任何一站帶固定時段（旅程檔手改漏了、或 fixedWindow 寫壞被拿掉）：那天會照營業時間當普通站排、整天像普通日，記整趟警告（10-14 T23 審查）
    if (d.type === 'fixed' && !candidates.some((c) => c.fixedWindow)) warnings.push({ code: 'fixed-day-no-window', date: d.date, msg: `${d.date} 標了固定時段日，但沒有一站帶固定時段（picks[].fixedWindow），會場會照營業時間當普通站排` });
    const win = dayWindow(d, index, settings, d.type === 'arrival' || d.type === 'departure' ? airportTransitMin({ legFn, home, settings }) : 0);
    for (const w of win.warnings) warnings.push({ ...w, date: d.date, msg: `${d.date} ${w.msg}` });
    const day = {
      date: d.date, type: d.type ?? 'normal', earlyDay: Boolean(d.earlyDay), dayTrip: Boolean(d.dayTrip), party: trip.party ?? 1,
      dayTripNext: prevType === 'daytrip' || Boolean(trip.days[index - 1]?.dayTrip),
      themeCategory, prevThemeCategory: prevTheme,
      anchorPoiId: anchorPoi?.id ?? null, anchorName: anchorPoi?.name_zh ?? d.anchor?.theme ?? null,
      designated: d.designated ?? [], regionZones: regionZonesOf({ home, candidates, anchorPoi }), homeZoneId: home?.zoneId ?? null,
      window: { startMin: win.startMin, endMin: win.endMin }, windowRaw: win.raw, openSlotMin: win.openSlotMin,
      openSlotSkipped: win.warnings.some((w) => w.code === 'open-slot-skipped'),
      nightSlotOff: Boolean(d.nightSlotOff) || Boolean(trip.days[index + 1]?.earlyDay),
      // 購物日（原話 #36、#55；DESIGN §1.5）：規則 shopping-day 讀；非購物日 false／null
      shoppingDay: shopping.has(d.date), shoppingFromMin: shopping.get(d.date)?.fromMin ?? null,
    };
    // 先照他勾的排；走路連跑破表（插恢復站）或等開門超過留白（填空檔）才把那種站加進候選重排一次，有比較好才採用。
    // 不每天都加：價值 0 的候選不受上界剪枝，試走包的 8/15 一加就從 276 節點變 6 萬節點、撞 800 ms 預算（2026-10-11 實測），結果還一樣。
    // 他拒絕過哪一種（原話 #126；profile §2.4「當天不再重插，連跑警告降成提示」）那天就不插那一種、它的觸發警告標 hint，畫面用提示樣式。
    let plan = planDay({ candidates, day, home, legFn, rules, settings, country, kb, options });
    const rejected = rejectedKinds(d.removed);
    const exclude = new Set([...pickedAnywhere, ...removedAnywhere, ...insertedSoFar]);
    const extra = extraCandidates({ restPool, candidates, day, exclude, home, plan, settings, rejected, legFn });
    if (extra.length) {
      const withExtra = planDay({ candidates: [...candidates, ...extra], day, home, legFn, rules, settings, country, kb, options });
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
    out.push({ date: d.date, day, plan });
    prevTheme = themeCategory; prevType = d.dayTrip ? 'daytrip' : (d.type ?? 'normal');
  });
  return { days: out, warnings };
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
    const stop = { poi: c.poi, dwellMin: c.dwellMin, priority: c.priority, optional: true, insertedBy: 'engine', isAnchor: false, designated: false, fixedWindow: null, gap: null, errand: false, detourMin: c.detourMin };
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
      const trial = retimeSequence({ sequence: [...seq.slice(0, i), stop, ...seq.slice(i)], day, home, legFn });
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
 * 同類上限、站數、逛店連跑等規則照管，他不要就按「不去了」（記 priority 'onway'，那天不再插順路站）。
 */
export function onTheWayCandidates({ restPool = [], day, exclude = new Set(), home = null, plan, legFn, settings = {} }) {
  if (!restPool.length || !plan?.sequence?.length) return [];
  const maxDetour = settings.onTheWayDetourMin ?? 8;
  // 順路站是「值得逛」的店，不拿恢復站（咖啡廳、餐廳、酒吧由恢復站與填站的邏輯管）
  const pool = restPool.filter((p) => engineMayInsert(p) && !NO_FILL_CATEGORIES.has(p.category) && !SHOPPING_CATEGORIES.includes(p.category) && p.recovery !== true && p.hours && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id));
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
    // 錢湯／日歸溫泉要準備（毛巾、換洗，profile §5.9），引擎不自己插；他勾了才會在 picks 裡
    .filter((p) => engineMayInsert(p) && p.recovery === true && p.category !== 'onsen' && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id))
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
  const pool = restPool.filter((p) => engineMayInsert(p) && !NO_FILL_CATEGORIES.has(p.category) && (day.regionZones ?? []).includes(p.zoneId) && !exclude.has(p.id));
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
