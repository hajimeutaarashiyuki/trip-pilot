// 二選一與順延（T16；DESIGN §6.3.2；profile §7「二選一與順延」、總則 6；原話 #119「兩間店都可以的情況下，那程式給我二選一的選項，然後我選一間，到了 17 號就會自動排進另一間」、
// #121 二選一是調整工具不是關卡：整趟排好、他只改不順眼的；#138 出現過但沒選的可以再出現，去過的不再出現）。
// 純函式：proposeChoices 只看排好的序列、不進分數與時刻（planTrip 排完七天才掛 plan.choices）；defer 用 planTrip 試排、回新的 trip（不改傳入的）。
import { swapCandidates, swapDetourMin } from './swap.js';
import { openIntervals } from './time.js';
import { SAME_TYPE_CATEGORIES } from '../rules/_helpers.js';
import { planTrip } from './trip.js';

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

/** 序列裡會出二選一的站 A（④品項層）：他勾的（不是引擎插的）、不是 must、不是指定站、不是主行程、沒有固定時段，店型在同類上限的那三類（vintage／record／cafe）。 */
export function isChoiceStop(s) {
  return Boolean(s?.poi) && !s.insertedBy && s.priority !== 'must' && !s.designated && !s.isAnchor && !s.fixedWindow && SAME_TYPE_CATEGORIES.includes(s.poi.category);
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
 * 2. 候選池：swapCandidates 的結果（繞路 ≤ settings.swapDetourMaxMin、那個時段有開或查不到）再過濾同 category（餐段放寬那條不適用，咖啡廳只配咖啡廳）、
 *    choiceEligible、不在 exclude（任何一天勾過的、按過「不去了」的、任何一天序列裡出現過的——含引擎插的、按過「我進去了」的）、知識庫沒去過的。
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
      if (openAtSlot(d.poi, s, date) === false) continue;   // 當天休息、或 A 的時段它沒開：那是營業時間擋的，不是「今天只塞得下一家」
      pairs.push({ slot, a: s, b: d.poi, source: 'dropped', detourMin: swapDetourMin(seq, slot, d.poi, legFn) });
    }
    // 這天已經有同店型的勾選站排不進（他這類今天已經想去三家、只塞得下兩家）就不再從候選池拿第四家來問：問了也只是把他勾的擠掉（10-16 審查的 high：8/13 Elbe 或 FLAT WHITE 按下去珈巣多夢落到排不進；主控覆核定的，推導自原話 #121 二選一是調整工具不是關卡）
    const droppedSameType = (plan.dropped ?? []).some((d) => d?.poi && d.poi.category === cat && d.priority !== 'must' && d.poi.id !== s.poi.id);
    if (!pool.length || droppedSameType) return;
    for (const c of swapCandidates({ plan, stopId: s.poi.id, pool, legFn, date, settings })) {
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
  const placed = (date, trial) => {
    const entry = { poiId, chosenPoiId, fromDate, toDate: date, status: 'placed', at };
    return { trip: withDeferredEntry(withoutPick(trial, fromDate, poiId), entry), entry, toDate: date };
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
    if (!displaces) return placed(date, trial);
    fallback ??= { date, trial };
  }
  if (fallback) return placed(fallback.date, fallback.trial);
  const entry = { poiId, chosenPoiId, fromDate, toDate: null, status: 'unplaced', at };
  return { trip: withDeferredEntry(base, entry), entry, toDate: null };
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
 * 那天引擎不再把它當恢復站／填站插回來、二選一也不再把它當 B 拿出來（10-16 審查：unplaced 的 A 重排後立刻以「或 A」出現在 B 的卡上，跟頂端那句矛盾）；別天照舊（原話 #138 沒選的可以再出現）。
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
