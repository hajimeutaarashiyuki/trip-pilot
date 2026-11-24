// 二選一與順延（T16；DESIGN §6.3.2；profile §7「二選一與順延」、總則 6；原話 #119「兩間店都可以的情況下，那程式給我二選一的選項，然後我選一間，到了 17 號就會自動排進另一間」、
// #121 二選一是調整工具不是關卡：整趟排好、他只改不順眼的；#138 出現過但沒選的可以再出現，去過的不再出現）。
// 純函式：proposeChoices 只看排好的序列、不進分數與時刻（planTrip 排完七天才掛 plan.choices）；defer 用 planTrip 試排、回新的 trip（不改傳入的）。
import { swapCandidates, swapDetourMin, applySwap, samePlace } from './swap.js';
import { openIntervals } from './time.js';
import { SAME_TYPE_CATEGORIES } from '../rules/_helpers.js';
import { servesMeal } from '../rules/_slots.js';   // 換進來的店能不能當早餐（能的話不讓它搶走那天原本的早餐卡；swapInPlace 第 5 步）
import { swapBreakfast, breakfastSwapsInPlace, breakfastOfPlan } from './breakfast.js';   // 早餐那一站的換一家：他勾的站當早餐時先把那天釘住再原位置換掉（swapBreakfastTrip）
import { planTrip } from './trip.js';
import { repinFromPlan, pinDayAsPlanned, pinnedOf, SWAP_PICK, isLateVia } from './insert.js';   // 釘住順序的日子（原話 #192；days[].pinned）：順延進來的站排在哪個位置要記回那天的順序；換一家、二選一先把那天照畫面上這一版釘住

/**
 * 二選一的 B 要過的門：跟引擎插站的 engineMayInsert 同四條（curated:false 挖寶型、他評 ≤2 星、落選兩次、unlockWhen 未達不出），
 * 但**不排除有 item 的**——④就是品項層，代購研究的店本來就該在這一層出現（DESIGN §6.3.2「兩家都是④品項層」）。
 */
export function choiceEligible(p) {
  if (!p) return false;
  if (p.curated === false) return false;
  if (Number.isFinite(p.my?.rating) && p.my.rating <= 2) return false;
  if ((p.poolLosses ?? 0) >= 2) return false;
  if (p.unlockWhen) return false;
  return true;
}

/**
 * 序列裡會出二選一的站 A（④品項層）：他勾的（不是引擎插的）、不是 must、不是指定站、不是主行程、沒有固定時段，店型在同類上限的那三類（vintage／record／cafe）。
 * 他指定當早餐的那一站（stop.breakfast；engine/breakfast.js）不出：早餐卡有自己的「換一家」（只列能當早餐的店），二選一問的是「這一類今天去哪一家」，兩個放在同一張卡上會打架。
 */
export function isChoiceStop(s) {
  return Boolean(s?.poi) && !s.insertedBy && !s.breakfast && s.priority !== 'must' && !s.designated && !s.isAnchor && !s.fixedWindow && SAME_TYPE_CATEGORIES.includes(s.poi.category);
}

/** 去過的店不再出現（原話 #138）：知識庫 my.visits 非空。 */
const visitedInKb = (p) => Array.isArray(p?.my?.visits) && p.my.visits.length > 0;

/** B 在 A 的時段（A 的開始時刻起、停 B 自己的分鐘）有沒有開：跟 swap.js swapCandidates 同一個算法；null＝查不到營業時間（當有開）；序列沒帶時刻就只看當天有沒有營業。 */
function openAtSlot(b, a, date) {
  const iv = openIntervals(b, date);
  if (iv === null) return null;
  if (!Number.isFinite(a?.startMin)) return iv.length > 0;
  const dwell = b.dwellMin ?? a.dwellMin ?? 0;
  return iv.some(([o, cl]) => a.startMin >= o && a.startMin + dwell <= cl);
}

/**
 * proposeChoices({ plan, date, pool, legFn, settings, exclude }) → [{ date, poiId: A, slot, options: [A, B], source: 'dropped' | 'pool', detourMin, altPoi: B 的 POI }]
 * 對序列裡每一站 A（isChoiceStop）找一家同店型的 B，先 (1) 再 (2)：
 * 1. 那天排不進的同類勾選站（plan.dropped 裡同 category、priority 不是 must、**A 的時段它要有開**——跟候選池同一道門，查不到營業時間就當有開）——他兩家都想去、今天只塞得下一家（profile §7 的定義）。
 *    不套繞路門檻：兩家都是他勾的，按了之後整天重排，不是把 B 塞進 A 的位置（10-16 實作時的判斷：仙台包 8/13 火星之庭離 Elbe 27 分、離珈巣多夢 19 分，套了就不會出；待確認）。
 *    時段那道門是 10-16 審查後加的：B 因營業時間排不進（09:30 關、A 排 09:50）也出「或 B」、畫面寫「今天只塞得下一家」，按了 B 還是排不進、A 又被順延走，這天那一類從一家變零家。
 * 2. 候選池：swapCandidates 的結果（繞路 ≤ settings.swapDetourMaxMin、那個時段有開或查不到；一律照同店型列——傳 meal: null，咖啡廳只配咖啡廳，
 *    這一站剛好是那天的某一餐也不改列「能當那一餐的店」；不是一個地點、研究判可略過、還沒解鎖、挖寶型的 swapCandidates 自己就不列）再過濾同 category、
 *    choiceEligible、不在 exclude（任何一天勾過的、按過「不去了」的、任何一天序列裡出現過的——含引擎插的、按過「我進去了」的）、知識庫沒去過的。
 * 同一處（知識庫 samePlace；11-24 傍晚主控裁決乙6）：(1) 的那幾家裡，跟這天行程裡的站同一處的不列；(2) 這天行程裡的站的另一筆 swapCandidates 本來就不列，
 *    別天的站的另一筆由呼叫端把 exclude 連同一處一起給（engine/trip.js planTrip 的 withTwins）。
 * 每個 A 最多一個 B：來源 (1) 優先，同來源取繞路最小的；一個 B 只配給一個 A（繞路最小的那個）。沒配到的 A 不出（照引擎）。
 */
export function proposeChoices({ plan, date, pool = [], legFn, settings = {}, exclude = new Set() }) {
  const seq = plan?.sequence ?? [];
  if (!seq.length || !legFn) return [];
  const pairs = [];
  seq.forEach((s, slot) => {
    if (!isChoiceStop(s)) return;
    const cat = s.poi.category;
    for (const d of plan.dropped ?? []) {
      if (!d?.poi || d.poi.category !== cat || d.priority === 'must' || d.poi.id === s.poi.id) continue;
      if (seq.some((x) => samePlace(x.poi, d.poi))) continue;   // 跟這天行程裡的站同一處（知識庫 samePlace）：選了等於同一個地方排兩次、或拿一家店換它自己（11-24 乙6）
      if (openAtSlot(d.poi, s, date) === false) continue;   // 當天休息、或 A 的時段它沒開：那是營業時間擋的，不是「今天只塞得下一家」
      pairs.push({ slot, a: s, b: d.poi, source: 'dropped', detourMin: swapDetourMin(seq, slot, d.poi, legFn) });
    }
    // 這天已經有同店型的勾選站排不進（他這類今天已經想去三家、只塞得下兩家）就不再從候選池拿第四家來問：問了也只是把他勾的擠掉（10-16 審查的 high：8/13 Elbe 或 FLAT WHITE 按下去珈巣多夢落到排不進；主控覆核定的，推導自原話 #121 二選一是調整工具不是關卡）
    const droppedSameType = (plan.dropped ?? []).some((d) => d?.poi && d.poi.category === cat && d.priority !== 'must' && d.poi.id !== s.poi.id);
    if (!pool.length || droppedSameType) return;
    // meal: null＝不管這一站是不是哪一餐，一律照「同店型」列（咖啡廳只配咖啡廳）：二選一問的是「這一類今天去哪一家」，不是「這一餐吃哪裡」。
    // 不給的話，知識庫標了能當午餐的咖啡廳剛好是那天的午餐時，換一家會改列能當午餐的店（餐廳、居酒屋），濾完同店型只剩也能當午餐的咖啡廳，B 會平白變少（11-06 第二批）。
    for (const c of swapCandidates({ plan, stopId: s.poi.id, pool, legFn, date, settings, meal: null })) {
      if (c.poi.category !== cat || c.open === false || !choiceEligible(c.poi) || exclude.has(c.poi.id) || visitedInKb(c.poi)) continue;
      pairs.push({ slot, a: s, b: c.poi, source: 'pool', detourMin: c.detourMin });
    }
  });
  // 配對：來源 (1) 先、再繞路少的、再序列前面的；A 配過或 B 配過就跳過
  const rank = (p) => (p.source === 'dropped' ? 0 : 1);
  pairs.sort((x, y) => rank(x) - rank(y) || x.detourMin - y.detourMin || x.slot - y.slot);
  const aTaken = new Set(); const bTaken = new Set(); const out = [];
  for (const p of pairs) {
    if (aTaken.has(p.slot) || bTaken.has(p.b.id)) continue;
    aTaken.add(p.slot); bTaken.add(p.b.id);
    out.push({ date, poiId: p.a.poi.id, slot: p.slot, options: [p.a.poi.id, p.b.id], source: p.source, detourMin: p.detourMin, altPoi: p.b });
  }
  return out.sort((x, y) => x.slot - y.slot);
}

/**
 * 順延：把 poiId 排到別天（A 被換成 B 之後把 A 排走；「排不進」清單上的站也直接用，chosenPoiId 可為 null）。
 * defer({ trip, pois, poiId, fromDate, chosenPoiId, baseline, planArgs }) → { trip: 新的 trip, entry, toDate }
 * - baseline：當下的 planTrip 結果（每天的 day 上下文：regionZones、themeCategory、shoppingDay；DESIGN「兩個優先都要 ctx.dayRegion 含該 POI」）
 * - planArgs：planTrip 的其他參數（rules、settings、country、kb、legFn、restPool、options）
 * 候選日（deferCandidateDays）：先同店型的主題日、再其餘日子，各自由早到晚（原話 #138 前後不拘）；排除 fromDate、不是 normal 的日子（抵達、離境、固定時段日——DESIGN §6.3.2「任何該日有開的 normal 日」；
 * 10-16 審查：之前只排除離境日，仙台包 Elbe／me／SQUAT 全落到 8/12 抵達日晚上、擠掉他勾的唐吉訶德）、一日遊的日子（出去一整天的，推導）、購物日（profile §5.3 古著最後一天不排）、
 * 那天休息的（openIntervals 空陣列；null＝查不到就當有開）、當日區域不含它的 Zone 的、**他在那天把它換掉過的**（day.swapped[].from 有它：二選一選了 B 頂掉它、或「換一家」換掉它——
 * 10-16 審查：之前再順延一次會彈回他當初選 B 的那天、把 B 擠出去）。
 * 每個候選日複製 trip、那天 picks 加 { poiId, priority, deferredFrom: fromDate }——priority 沿用它在 fromDate 的優先度（maybe 搬過去還是 maybe；10-16 審查後改的，之前一律 want、
 * 會把那天他勾的 maybe 擠掉；規格寫 want，待確認）——用 planTrip 的 options.onlyDates 只試排那一天：序列有它、排不進沒它＝排得進。
 * 排得進的日子裡先要「沒擠掉別的勾選站」的（那天的 plan.dropped 跟 baseline 比沒多出別家；10-16 審查後加的：仙台包 me 從 8/17 順延，8/13 排得進但把珈巣多夢擠進排不進清單，
 * 8/15 排得進又不擠人，之前照日期先到先得就落在 8/13），沒有這種日子才退而求其次用第一個排得進的（擠掉誰由畫面那句講——ui/choices.js displacedPicks）；試排的次數不多於候選日數。定案：
 * trip.deferred[] 記 { poiId, chosenPoiId, fromDate, toDate, status: 'placed', at }、那天的 pick 留著、fromDate 的同一站拿掉（它搬走了，不然同一家店兩天都勾）；
 * 全排不進 → status 'unplaced'、toDate null、試排的 pick 不留、fromDate 的 pick 不動（排不進清單那站留在原處，候選池照舊；poolLosses 不加）。
 * 同一 poiId 已有紀錄就覆蓋那筆、之前順延到的那天的 pick 先拿掉（第二次順延不會兩天都有）。
 */
export function defer({ trip, pois, poiId, fromDate, chosenPoiId = null, baseline = null, planArgs = {}, priority = null }) {
  const poi = pois?.[poiId] ?? null;
  const at = new Date().toISOString();
  const pri = priority ?? pickPriority(trip, fromDate, poiId) ?? 'want';
  const base = withoutDeferredPick(trip, poiId);
  const candidates = poi ? deferCandidateDays({ trip: base, poi, fromDate, baseline }) : [];
  // 排到釘住順序的日子（days[].pinned；engine/insert.js）：那天不搜尋，planTrip 會試每個位置、挑排得下而且分數最高的插（排不下就落在排不進清單，下面的迴圈當作這天排不進、換下一天試）。
  // 排定之後把試排出來的先後記回那天的 pinned（repinFromPlan）——不記的話每次重排都重新挑位置，他調過的順序裡會有一站自己換位置。沒釘住的日子 repinFromPlan 原樣回。
  const placed = (date, trial, plan) => {
    const entry = { poiId, chosenPoiId, fromDate, toDate: date, status: 'placed', at };
    return { trip: withDeferredEntry(withoutPick(repinFromPlan(trial, date, plan), fromDate, poiId), entry), entry, toDate: date };
  };
  // 那天重排前就排不進的（baseline 那天的 plan.dropped）：試排後還在不算被它擠掉；baseline 沒那天的 plan 就看不出來、當沒擠
  const baselinePlan = (date) => (baseline?.days ?? []).find((x) => x?.date === date)?.plan ?? null;
  let fallback = null;
  for (const date of candidates) {
    const trial = withPick(base, date, { poiId, priority: pri, deferredFrom: fromDate });
    const r = planTrip({ ...planArgs, trip: trial, pois, options: { ...(planArgs.options ?? {}), onlyDates: [date] } });
    const plan = r.days.find((x) => x.date === date)?.plan;
    if (!plan || !plan.sequence.some((s) => s.poi.id === poiId) || plan.dropped.some((x) => x.poi.id === poiId)) continue;
    const before = baselinePlan(date);
    const was = new Set((before?.dropped ?? []).map((x) => x.poi.id));
    const displaces = Boolean(before) && plan.dropped.some((x) => !was.has(x.poi.id));
    if (!displaces) return placed(date, trial, plan);
    fallback ??= { date, trial, plan };
  }
  if (fallback) return placed(fallback.date, fallback.trial, fallback.plan);
  const entry = { poiId, chosenPoiId, fromDate, toDate: null, status: 'unplaced', at };
  return { trip: withDeferredEntry(base, entry), entry, toDate: null };
}

/**
 * 這筆勾選在那天是不是動不得的：必去、指定站、主行程、帶固定時段的（跟 engine/insert.js isLockedStop 同四種，這裡看的是旅程檔那天的勾選，排不進的站也判得出來）。
 * 換一家清單不把別天這種站列成可以挪過來的（ui/meals.js），swapInPlace 也不動它——那一天不能就這樣少了主行程或釘了時間的站。那天沒勾這家回 false。
 */
export function lockedPick(tripDay, poiId) {
  const p = (tripDay?.picks ?? []).find((x) => x?.poiId === poiId);
  return p?.priority === 'must' || Boolean(p?.fixedWindow) || (tripDay?.designated ?? []).includes(poiId) || tripDay?.anchor?.poiId === poiId || Boolean(tripDay?.anchor?.poiIds?.includes(poiId));
}

/** baseline（planTrip 的結果、或 { days: [{ date, plan }] }）裡某一天畫面上的 plan；沒有回 null。 */
const baselinePlanOn = (baseline, date) => (baseline?.days ?? []).find((x) => x?.date === date)?.plan ?? null;

/**
 * 把 toPoi 從 date 以外的日子挪走（它要換進 date 那天了；同一家店不會兩天各去一次——主控 11-24 定，推導自原話 #90、#195）：
 * 別天勾著它（或同一處的另一筆；知識庫 samePlace）的那筆勾選拿掉——不記 removed（不是「不去了」、不留拒絕紀錄）、不記 swapped、不算落選；
 * 它是順延到那天的（trip.deferred 那一筆 placed 而且 toDate 就是那天）就把那筆順延紀錄拿掉。lockedPick 的不動。
 * 它原本那天不整天重排（11-24 傍晚主控裁決甲1；原話 #192 的類推——他只動了一站，別的站不該跟著動；推導、待收口）：
 * - 那家在那天畫面上的行程裡（baseline 那天的 plan.sequence：他勾的排進去的、或引擎排的，含同一處的另一筆）而那天還沒釘住 → 先照畫面上這一版釘住（engine/insert.js pinDayAsPlanned），
 *   再把那一筆原位置拿掉：他勾的那一筆從順序裡拿掉；引擎排的那一筆留著、標成不排（off——別天照樣不拿它，跟釘住的日子被讓掉的引擎站同一種）。
 *   重排之後那天就是原順序少掉那一家，引擎不替那天補站（可能少一餐、多一句提示）；要引擎補由他按那天的「讓引擎重排這天」。
 * - 那家在那天只是「勾了沒排進」（畫面上沒有站要動）→ 只拿掉勾選、不釘住；pinIdle 給了才照畫面釘住（畫面先不給、重排後整趟不一樣才補這一步——ui/app.js swapStop）。
 * - 那天本來就釘住：照舊在那條順序上拿掉那一筆。baseline 沒給、或沒有那一天的 plan：沒得釘，只拿掉勾選（那天沒釘住就照舊整天重排）。
 * 之前（11-24 下午那一版）一律只拿掉勾選：那天沒釘住就整天重新搜尋——對抗審查在七天包量 65 次，那天除了少掉那家還有別的變 56 次、他勾的站先後變了 27 次、
 * 他勾的另一站掉進排不進 5 次、連第三天也變 19 次。沒有東西要改回原 trip（同一個物件）。
 */
function withoutElsewhere(trip, date, toPoi, pois, { baseline = null, pinIdle = false, at = null } = {}) {
  const same = (id) => id === toPoi.id || samePlace(pois[id], toPoi);
  const gone = [];
  let out = trip;
  for (const d of trip.days) {
    if (d.date === date) continue;
    const hit = (d.picks ?? []).filter((p) => p?.poiId && same(p.poiId) && !lockedPick(d, p.poiId)).map((p) => p.poiId);
    const plan = baselinePlanOn(baseline, d.date);
    const onScreen = (plan?.sequence ?? []).some((s) => (s.insertedBy ? same(s.poi.id) : hit.includes(s.poi.id)));
    const recorded = (pinnedOf(d)?.sequence ?? []).some((e) => e.insertedBy === 'engine' && !e.off && same(e.poiId));
    if (!hit.length && !onScreen && !recorded) continue;
    if (onScreen || (pinIdle && hit.length)) out = pinDayAsPlanned(out, d.date, plan, at);
    for (const id of hit) gone.push(`${d.date}|${id}`);
    out = { ...out, days: out.days.map((x) => (x.date === d.date ? withoutStop(x, hit, same) : x)) };
  }
  if (out === trip) return trip;
  if (gone.length && Array.isArray(trip.deferred)) out.deferred = trip.deferred.filter((e) => !(e?.status === 'placed' && gone.includes(`${e.toDate}|${e.poiId}`)));
  return out;
}

/** withoutElsewhere 的那一天：hit 那幾筆勾選拿掉；釘住的順序裡他勾的那幾筆拿掉、記著的引擎站是那一家（same）的標成不排。回新的 day。 */
function withoutStop(day, hit, same) {
  const next = hit.length ? { ...day, picks: day.picks.filter((p) => !hit.includes(p?.poiId)) } : { ...day };
  if (day.pinned && Array.isArray(day.pinned.sequence)) {
    next.pinned = { ...day.pinned, sequence: day.pinned.sequence.filter((e) => !(hit.includes(e?.poiId) && e.insertedBy !== 'engine'))
      .map((e) => (e?.insertedBy === 'engine' && !e.off && same(e.poiId) ? { poiId: e.poiId, insertedBy: 'engine', priority: e.priority, off: true } : e)) };
  }
  return next;
}

/**
 * 換一家、二選一選了 B，整趟的旅程檔怎麼改（11-24；主控定）：swapInPlace({ trip, date, fromPoiId, toPoi, plan, pois, at?, baseline?, pinIdle? }) → 新 trip（不改傳入的；沒有那一天、沒給店回原 trip）。
 * 1. 那天還沒釘住：先照畫面上這一版釘住（engine/insert.js pinDayAsPlanned；plan＝那天現在的 plan，沒給就不釘、退回只改勾選）。
 * 2. B 原本在別天（他勾的、引擎排的，含同一處的另一筆）：從那幾天挪走（withoutElsewhere）。baseline＝當下的 planTrip 結果（每天畫面上的 plan；跟 defer 的 baseline 同一個形狀）：
 *    給了，它原本那天就不整天重排——先照畫面釘住再原位置拿掉那一筆（11-24 傍晚主控裁決甲1）；pinIdle：那家在別天只是「勾了沒排進」時也把那天釘住（畫面視重排的結果才給）。
 * 3. 那天 A 原位置換成 B（chooseDay：勾選、swapped 紀錄、釘住的順序裡 A 的那一筆）。
 * 重排之後那天照釘住的順序排：B 在 A 的原位置、其餘各站（他勾的、引擎排的）先後不變、後面的時刻照新停留順延或提早；日期下面出現「這天照你調過的順序排」，
 * 要交回引擎由他按「讓引擎重排這天」（engine/insert.js unpinDay）。依據：原話 #192「順路站 升級成站時 不應該把原本的行程刪掉 應該是安插進來」講的是升級成站，
 * 類推到換一家是推導——他只說要換這一站，別的站不該跟著動。之前沒釘住的日子換了之後整天重新搜尋：選的那一家不保證排進去、當天別的勾選站可能被擠掉
 * （11-17 畫面審查：七天包 48 次裡 6 次、公務版 61 次裡 2 次、試走版 59 次裡 21 次有問題；當時的補法「沒排進去就多算 60 分再排一次」這次拿掉）。
 * 畫面列候選之前用 pinnedSwapCheck／pinnedChoiceCheck 試排——試排與真的套用走的就是這個函式，試出來沒事按下去才真的沒事。pois＝{ [id]: poi }（判同一處用）。
 * 4. 別天不跟著變（跟升級成站同一個道理；engine/trip.js planTrip 的 lateIds）：引擎每天挑插站的名單是「先扣掉不拿的店、再取最近的幾家」，
 *    他換了一家店，不拿的店就多一家（B）少一家（A），別天的名單會遞補、搜出來的行程跟著變。所以兩邊都記下來，讓別天的名單跟換之前一樣：
 *    - A：swapped 那一筆多 hold: true（A 原本那筆勾選帶「後來才加進來」的記號就一起記 via）——引擎在每一天都照舊不拿它（heldSwaps；沒有這個記號的舊紀錄照舊只管那一天）。
 *      不是「不去了」：換一家清單、走廊清單、二選一照舊可以再出現（原話 #138「有出現但我沒選擇，還是可以再次出現」），只是引擎不會自己把它排到別天。
 *      主控 11-24 採用（裁決甲3；推導、待收口）：10-16 的推導「換掉的店別天照舊可以被引擎排」作廢。
 *    - B：原本哪一天都沒勾（還沒排的、別天引擎排的）→ 那筆勾選記 via 'swap'（別天挑好名單才拿掉）；原本就是他勾的（別天挪過來的、這天排不進的那一筆）→ 沿用它自己那筆的記號（多半沒有：照舊一開始就扣掉）。
 * 5. 換進來的店不搶早餐卡（11-24 傍晚主控裁決甲5；推導）：那天已經有早餐（plan.meals.breakfast）、換掉的 A 又不是那一站，而 B 剛好能當早餐 → B 那筆勾選記 breakfast: false
 *    （「這一筆不當早餐」；engine/trip.js 帶到 day.notBreakfast，rules/_slots.js 配早餐時跳過它）。原本的早餐繼續是早餐、鍵照舊，B 是一般的站。
 *    之前原位置換掉之後 B 落在早餐時段、跟早餐時段重疊得比原本那一家多，早餐的小標與鍵就移到 B，引擎排的那一家變成一般的站，按「吃飯店早餐」拿掉的是 B
 *    （對抗審查：七天包 8/14 埃比昂 東一店 換成 Cafe de 埃比昂）。A 就是那天的早餐時不記：B 頂的就是早餐的位置。那天沒有早餐也不記。
 */
export function swapInPlace({ trip, date, fromPoiId, toPoi, plan = null, pois = {}, at = null, baseline = null, pinIdle = false }) {
  if (!toPoi?.id || !(trip?.days ?? []).some((d) => d?.date === date)) return trip;
  const all = pois[toPoi.id] ? pois : { ...pois, [toPoi.id]: toPoi };
  const own = trip.days.flatMap((d) => d?.picks ?? []).find((p) => p?.poiId && (p.poiId === toPoi.id || samePlace(all[p.poiId], toPoi)));   // B（或同一處的另一筆）原本的那筆勾選
  const base = withoutElsewhere(pinDayAsPlanned(trip, date, plan, at), date, toPoi, all, { baseline, pinIdle, at });
  const breakfastId = plan?.meals?.breakfast ?? null;
  const plain = Boolean(breakfastId) && breakfastId !== fromPoiId && servesMeal(toPoi, 'breakfast') !== false;
  return { ...base, days: base.days.map((d) => (d.date === date ? holdSwap(chooseDay(d, fromPoiId, toPoi, at), d, fromPoiId, toPoi.id, own ? own.via : SWAP_PICK, plain) : d)) };
}

/**
 * swapInPlace 第 4、5 步：next＝chooseDay 換好的那一天、before＝換之前的那一天；最後一筆 swapped 記 hold（與 A 的記號）、B 那筆勾選的 via 改成 bVia（沒有就拿掉這個鍵）；
 * plain＝B 不當這天的早餐（那筆勾選記 breakfast: false）。
 */
function holdSwap(next, before, fromPoiId, toPoiId, bVia, plain = false) {
  const aVia = (before.picks ?? []).find((p) => p?.poiId === fromPoiId)?.via;
  const last = (next.swapped ?? []).length - 1;
  return {
    ...next,
    picks: (next.picks ?? []).map((p) => { if (p?.poiId !== toPoiId) return p; const { via: _old, ...rest } = p; return { ...rest, ...(isLateVia(bVia) ? { via: bVia } : {}), ...(plain ? { breakfast: false } : {}) }; }),
    swapped: (next.swapped ?? []).map((x, i) => (i === last && x?.from === fromPoiId ? { ...x, hold: true, ...(isLateVia(aVia) ? { via: aVia } : {}) } : x)),
  };
}

/**
 * 早餐那一站按「換一家」選了 toPoi，整趟的旅程檔怎麼改（11-24 傍晚主控裁決甲4）：swapBreakfastTrip({ trip, date, toPoi, plan, at? }) → 新 trip（不改傳入的；沒給店回原 trip）。
 * 現在的早餐是他勾的站自己落在早餐時段（engine/breakfast.js breakfastSwapsInPlace）而那天還沒釘住：先照畫面上這一版釘住（pinDayAsPlanned）再換——
 * swapBreakfast 在釘住的日子就是原位置換掉：同一天引擎排的站不動、其餘各站先後不變，那天從此照他調過的順序排。依據同 swapInPlace（原話 #192 的類推，推導）。
 * 早餐是引擎排的、或他之前指定的：照舊直接換（那一筆本來就不進搜尋，其餘各站不受影響），那天不釘住。畫面列清單之前的試排（breakfastSwapCheck）走的也是這個函式。
 */
export function swapBreakfastTrip({ trip, date, toPoi, plan = null, at = null }) {
  if (!toPoi?.id) return trip;
  return swapBreakfast(breakfastSwapsInPlace(plan) ? pinDayAsPlanned(trip, date, plan, at) : trip, date, toPoi.id, plan, at);
}

/**
 * 早餐清單上的候選先試排（甲4）：breakfastSwapCheck({ trip, date, plan, pois, planArgs }) → (toPoi) → true＝可以列。
 * 只有「早餐是他勾的站自己落在早餐時段、那天還沒釘住」這一種要試（換了會把那天釘住、原位置換掉——跟 pinnedSwapCheck 同一個道理：真的換過去排那一天一次）：
 * 換進來的那家在原位置而且是那天的早餐、原本的每一站（他勾的、引擎排的）都還在而且先後不變、沒有站因此多掉進排不進才列。
 * 其餘的情況（早餐是引擎排的或他指定的、那天本來就釘住、那天沒有早餐）回永遠 true 的函式：engine/breakfast.js breakfastSwapCandidates 已經照那個排法試過。
 */
export function breakfastSwapCheck({ trip, date, plan, pois = {}, planArgs = {} }) {
  const cur = breakfastOfPlan(plan);
  if (!cur || plan.pinned || !breakfastSwapsInPlace(plan) || !(trip?.days ?? []).some((d) => d?.date === date)) return () => true;
  const before = plan.sequence.map((s) => s.poi.id);
  return (toPoi) => {
    if (!toPoi?.id) return false;
    const all = pois[toPoi.id] ? pois : { ...pois, [toPoi.id]: toPoi };
    const r = planTrip({ ...planArgs, trip: swapBreakfastTrip({ trip, date, toPoi, plan }), pois: all, options: { ...(planArgs.options ?? {}), onlyDates: [date] } });
    const p = r.days.find((x) => x.date === date)?.plan;
    return keptInOrder(before.map((id) => (id === cur.poi.id ? toPoi.id : id)), plan.dropped, p) && p.meals?.breakfast === toPoi.id;
  };
}

/**
 * 原位置換掉的那幾家 A（swapped[].hold；swapInPlace 記的）：引擎在每一天都照舊不拿它，別天的行程才不會因為他換了一家而跟著變。
 * 回 { pre: Set（一開始就扣掉——A 原本是一般的勾選）, late: Set（挑好名單才拿掉——A 原本是升級進來或換進來的勾選） }。engine/trip.js planTrip 每次排整趟算一次。
 */
export function heldSwaps(trip) {
  const pre = new Set(); const late = new Set();
  for (const d of trip?.days ?? []) for (const x of d?.swapped ?? []) if (x?.hold === true && typeof x.from === 'string' && x.from) (isLateVia(x.via) ? late : pre).add(x.from);
  return { pre, late };
}

/**
 * 按「換一家」之前先試排（11-12 審查起釘住的日子就有；11-24 起沒釘住的日子也試——換一家一律原位置換掉、把那天釘住，見 swapInPlace）。
 * pinnedSwapCheck({ trip, date, fromPoiId, plan, pois, planArgs }) → (toPoi) → true＝可以列。
 * 每一家真的換過去排那一天一次（swapInPlace＋planTrip 只排那天；跟他按下去之後走的是同一條路），下面都成立才是 true：
 * 換進來的那家排在原位置、原本的每一站（他勾的、引擎插的）都還在而且先後不變、沒有站因此多掉進排不進清單。原本排不進、換了之後跟著排得進來的站不算壞事。
 * 之前釘住的日子沒有這一步時：換進來的店停得比較久、或跟別站同類，排在前面的引擎站會被無聲拿掉、他勾的站落到排不進清單
 * （六個打包檔 817 次換一家裡 24 次：20 次引擎站不見、3 次他勾的站排不進、1 次換進來的那家自己排不進）。
 * plan＝那天現在排好的 plan；pois＝{ [id]: poi }；planArgs＝planTrip 的其他參數（rules、settings、country、kb、legFn、restPool、brief、options）。
 * 沒有那一天、沒有 plan 回一個永遠 true 的函式（沒得試）；要換的那一站不在序列裡回永遠 false。純函式，不改傳入的。畫面（ui/meals.js swapListOf）照清單的先後一家一家問它、湊滿要畫的家數就停。
 * baseline（選填；當下的 planTrip 結果，跟 swapInPlace 收的同一份）：給了，那家原本所在、會被照順序拿掉一筆的那幾天也一起試排（釘住的日子不搜尋，多排一天很便宜）——
 * 那天其餘各站都還在而且先後不變、沒有站因此多掉進排不進才列（原本排不進、跟著排得進來的不算壞事）。只是「勾了沒排進」而沒釘住的那一天不在這裡試（要整天搜尋；按下去之後畫面自己比，ui/app.js swapStop）。
 */
export function pinnedSwapCheck({ trip, date, fromPoiId, plan, pois = {}, planArgs = {}, baseline = null }) {
  const day = (trip?.days ?? []).find((d) => d?.date === date);
  if (!day || !Array.isArray(plan?.sequence)) return () => true;
  const before = plan.sequence.map((s) => s.poi.id);
  if (!before.includes(fromPoiId)) return () => false;
  return (toPoi) => {
    if (!toPoi?.id) return false;
    const all = pois[toPoi.id] ? pois : { ...pois, [toPoi.id]: toPoi };
    const trial = swapInPlace({ trip, date, fromPoiId, toPoi, plan, pois: all, baseline });
    const origins = trial.days.filter((d, i) => d !== trip.days[i] && d.date !== date && pinnedOf(d) && baselinePlanOn(baseline, d.date)).map((d) => d.date);
    const r = planTrip({ ...planArgs, trip: trial, pois: all, options: { ...(planArgs.options ?? {}), onlyDates: [date, ...origins] } });
    const planOn = (x) => r.days.find((y) => y.date === x)?.plan;
    if (!keptInOrder(before.map((id) => (id === fromPoiId ? toPoi.id : id)), plan.dropped, planOn(date))) return false;
    return origins.every((x) => { const was = baselinePlanOn(baseline, x); return keptInOrder(was.sequence.map((s) => s.poi.id).filter((id) => id !== toPoi.id && !samePlace(all[id], toPoi)), was.dropped, planOn(x)); });
  };
}

/** 試排的結果 p 裡，want 那幾站（照先後）都還在而且先後不變、沒有站比 wasDropped（試排前的排不進清單）多掉進去。p 沒有回 false。 */
function keptInOrder(want, wasDropped, p) {
  if (!p) return false;
  const was = new Set((wasDropped ?? []).map((x) => x.poi.id));
  return p.sequence.map((s) => s.poi.id).filter((id) => want.includes(id)).join('\n') === want.join('\n') && !(p.dropped ?? []).some((x) => !was.has(x.poi.id));
}

const PRIORITY_RANK = Object.freeze({ must: 3, want: 2, maybe: 1 });
/** 兩個優先度取高的（must > want > maybe；不認得的算最低）。 */
const higherPriority = (x, y) => ((PRIORITY_RANK[x] ?? 0) >= (PRIORITY_RANK[y] ?? 0) ? x : y);

/**
 * 換一家、二選一選了 B，那一天的旅程檔怎麼改：chooseDay(day, fromPoiId, toPoi, at?) → 新的 day（不改傳入的；先把那天釘住、把 B 從別天挪走是 swapInPlace 的事，A 順延到別天是 defer）。
 * 試排（pinnedSwapCheck／pinnedChoiceCheck）與真的套用走同一個函式，不然試排說沒事、套下去卻是另一個樣子。
 * - B 不在那天的 picks 裡（候選池來的）：就是 engine/swap.js applySwap——picks 原位置換掉、priority 沿用 A 的、記 day.swapped（換掉的不算落選）；
 *   釘住順序的日子 pinned 裡 A 的那一筆原位置換成 B。
 * - B 本來就是那天的勾選（當天勾了但排不進的那一家）：A 的那筆拿掉、B 自己那筆留著（停留照它自己的）、優先度取 A 與 B 之間高的
 *   （他選了它頂 A 的位置，至少要有 A 的分量；B 本來就比 A 高就不降——10-16 審查）；記 day.swapped。
 *   釘住順序的日子：pinned 裡 A 的那一筆原位置換成 B（B 在順序裡殘留的舊筆先清掉）。A 不在順序裡就不動 pinned
 *   （那種舊資料重排時順著 swapped 紀錄把接手的那家對回原位置——engine/insert.js planPinnedDay 的 heir）。
 * at：swapped 那一筆的時間戳（不給就是現在）。
 */
export function chooseDay(day, fromPoiId, toPoi, at = null) {
  const when = typeof at === 'string' && at ? at : new Date().toISOString();
  const own = (day.picks ?? []).find((p) => p.poiId === toPoi.id);
  if (!own) {
    const next = applySwap(day, fromPoiId, toPoi);
    return { ...next, swapped: next.swapped.map((x, i) => (i === next.swapped.length - 1 ? { ...x, at: when } : x)) };
  }
  const a = (day.picks ?? []).find((p) => p.poiId === fromPoiId);
  const picks = (day.picks ?? []).filter((p) => p.poiId !== fromPoiId).map((p) => (p === own ? { ...own, priority: higherPriority(a?.priority, own.priority) ?? 'want' } : p));
  const swapped = [...(day.swapped ?? []), { from: fromPoiId, to: toPoi.id, at: when }];
  const pin = day.pinned && typeof day.pinned === 'object' && Array.isArray(day.pinned.sequence) ? day.pinned : null;
  if (!pin || !pin.sequence.some((e) => e?.poiId === fromPoiId)) return { ...day, picks, swapped };
  const sequence = pin.sequence.filter((e) => e?.poiId !== toPoi.id).map((e) => (e?.poiId === fromPoiId ? { poiId: toPoi.id } : e));
  return { ...day, picks, swapped, pinned: { ...pin, sequence } };
}

/**
 * 二選一的「或 B」選了會不會讓其餘各站少掉或換位置（11-17 起釘住的日子先試排；11-24 起沒釘住的日子也試——選了 B 一律原位置換掉、把那天釘住，見 swapInPlace）。
 * pinnedChoiceCheck({ trip, date, plan, pois, planArgs }) → (choice) → true＝選了沒事、可以出這個「或 B」。choice＝plan.choices 的一筆（{ poiId: A, options: [A, B], altPoi: B 的 POI }）。
 * 跟換一家是同一個試排（pinnedSwapCheck）：真的選下去排那一天一次，B 排在 A 的原位置、原本的每一站（他勾的、引擎插的）都還在而且先後不變、沒有站因此多掉進排不進清單才是 true。
 * B 原本就在排不進清單（來源是今天排不進的勾選站）、選了排進來是本意，不算；別的原本排不進的站跟著排得進來也不算壞事。
 * A 順延到哪一天不影響這一天（順延那一步自己會試排，defer），不在這裡試。
 * 11-17 在六個打包檔上量釘住的日子（279 個釘住的情境、254 個「或 B」）：選了出事 1 個（10-27 舊七天包 8/17「星山珈琲店 或 darestore」：darestore 在那個時段撐不到），
 * 試排放行 253 個、選下去出事 0 個。會出事的是「B 的營業時間或停留跟 A 差很多」的那一種。
 * plan＝那天現在排好的 plan；pois＝{ [id]: poi }；planArgs＝planTrip 的其他參數。沒有那一天、沒有 plan 時沒得試、放行。純函式，不改傳入的。
 */
export function pinnedChoiceCheck({ trip, date, plan, pois = {}, planArgs = {} }) {
  return (choice) => {
    const toPoi = choice?.altPoi ?? pois[choice?.options?.[1]] ?? null;
    return Boolean(choice?.poiId) && Boolean(toPoi?.id) && pinnedSwapCheck({ trip, date, fromPoiId: choice.poiId, plan, pois, planArgs })(toPoi);
  };
}

/**
 * 這天畫面上可以出的二選一：choicesFor({ trip, date, plan, pois, planArgs }) → plan.choices 的子集——只留試排過、選了沒事的（pinnedChoiceCheck；11-24 起不分釘不釘住）。
 * 畫面畫「或 B」拿這一份，不直接拿 plan.choices。那天沒有二選一就回原陣列（空的）。
 */
export function choicesFor({ trip, date, plan, pois = {}, planArgs = {} }) {
  const list = plan?.choices ?? [];
  if (!list.length) return list;
  return list.filter(pinnedChoiceCheck({ trip, date, plan, pois, planArgs }));
}

/**
 * 順延的候選日（日期字串陣列）：同店型主題日優先、再其餘日子，各自由早到晚；排除 fromDate、不是 normal 的日子（抵達、離境、固定時段）、一日遊、購物日、那天休息、當日區域不含、
 * 他在那天換掉過它的（day.swapped[].from）。
 */
export function deferCandidateDays({ trip, poi, fromDate, baseline }) {
  const ctxOf = new Map((baseline?.days ?? []).map((d) => [d.date, d.day]).filter(([, day]) => day));
  const ok = (d) => {
    if (!d?.date || d.date === fromDate || (d.type ?? 'normal') !== 'normal' || d.dayTrip) return false;
    if ((d.swapped ?? []).some((x) => x?.from === poi.id)) return false;
    const ctx = ctxOf.get(d.date);
    if (!ctx || ctx.shoppingDay) return false;
    const iv = openIntervals(poi, d.date);
    if (Array.isArray(iv) && !iv.length) return false;
    return (ctx.regionZones ?? []).includes(poi.zoneId);
  };
  const list = (trip?.days ?? []).filter(ok).map((d) => d.date).sort();
  const theme = list.filter((date) => ctxOf.get(date)?.themeCategory === poi.category);
  return [...theme, ...list.filter((date) => !theme.includes(date))];
}

/** trip.deferred 裡這家店的那筆（沒有回 null）。 */
export function deferredEntry(trip, poiId) {
  return (trip?.deferred ?? []).find((e) => e?.poiId === poiId) ?? null;
}

/** 這家店在那天 picks 裡的優先度（沒勾回 null）：順延時沿用。 */
function pickPriority(trip, date, poiId) {
  return (trip?.days ?? []).find((d) => d.date === date)?.picks?.find((p) => p.poiId === poiId)?.priority ?? null;
}

/**
 * 他在那天換掉過的站（二選一選了 B 頂掉的 A、「換一家」換掉的；day.swapped[].from）∪ 二選一沒選、別天也排不進的（trip.deferred unplaced）在它被頂掉的那天（fromDate）：
 * 那天引擎不再把它當恢復站／填站插回來、二選一也不再把它當 B 拿出來（10-16 審查：unplaced 的 A 重排後立刻以「或 A」出現在 B 的卡上，跟頂端那句矛盾）。
 * 這個函式只管「那一天」。別天的事分兩種（11-24 主控裁決甲3；推導、待收口）：
 * - 引擎自己排：換掉的店整趟都不由引擎自己排到別天（swapped[].hold；heldSwaps 管）——10-16 那條推導「換掉的店別天照舊可以被引擎排」作廢。
 *   理由：他只換了這一站，別天的行程不該因此跟著變（原話 #192 的類推）。沒有 hold 記號的舊紀錄（11-24 之前存的）照舊只擋那一天。
 * - 他自己選：二選一的 B、走廊清單、換一家清單在別天照舊可以出現它、選得到（原話 #138「有出現但我沒選擇，還是可以再次出現」）。
 * planTrip 每天算一次（engine/trip.js）。回 id 陣列。
 */
export function swappedAwayFrom(trip, date) {
  const day = (trip?.days ?? []).find((d) => d?.date === date);
  const swapped = (day?.swapped ?? []).map((x) => x?.from).filter(Boolean);
  const unplaced = (trip?.deferred ?? []).filter((e) => e?.status === 'unplaced' && e.fromDate === date && e.poiId).map((e) => e.poiId);
  return [...new Set([...swapped, ...unplaced])];
}

/** 那天 picks 加一筆（已經在就換成這筆）；回新的 trip，不改傳入的。 */
function withPick(trip, date, pick) {
  return { ...trip, days: trip.days.map((d) => (d.date === date ? { ...d, picks: [...(d.picks ?? []).filter((p) => p.poiId !== pick.poiId), pick] } : d)) };
}

/** 那天 picks 拿掉這家店；回新的 trip。 */
function withoutPick(trip, date, poiId) {
  return { ...trip, days: trip.days.map((d) => (d.date === date && (d.picks ?? []).some((p) => p.poiId === poiId) ? { ...d, picks: d.picks.filter((p) => p.poiId !== poiId) } : d)) };
}

/** 任何一天帶 deferredFrom 的這家店的 pick 都拿掉（上一次順延的那筆）；回新的 trip。 */
function withoutDeferredPick(trip, poiId) {
  return { ...trip, days: (trip?.days ?? []).map((d) => ((d.picks ?? []).some((p) => p.poiId === poiId && p.deferredFrom) ? { ...d, picks: d.picks.filter((p) => !(p.poiId === poiId && p.deferredFrom)) } : d)) };
}

/** trip.deferred 加／覆蓋同 poiId 的那筆；回新的 trip。 */
function withDeferredEntry(trip, entry) {
  return { ...trip, deferred: [...(trip.deferred ?? []).filter((e) => e?.poiId !== entry.poiId), entry] };
}
