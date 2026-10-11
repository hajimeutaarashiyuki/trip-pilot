// 整趟：把旅程的每一天交給 planDay（第一版：分天是他在規劃頁點的，引擎只排單日；決策樹 Q7）。
// 這裡負責把 Trip／Day 的資料翻成 planDay 要的 day 上下文：時窗、早起日、晚出門、主題、主行程、指定站、當日區域。
import { planDay } from './core.js';
import { hmToMin } from './time.js';
import { haversineM } from '../geo/matrix.js';

/**
 * 引擎插站的觸發：照他勾的排完後出現這些規則的警告才跑第二趟。
 * walk-run：DESIGN §1.3「走路連跑要破 150 才由引擎插恢復站」→ restCandidates（只拿恢復站）；
 * wait-at-door：等開門空檔填站，任何站都可以（原話 #161）→ fillCandidates（離那段空檔最近的任何站型）。
 */
export const REST_TRIGGER_RULES = new Set(['walk-run', 'wait-at-door']);

/** 一天的時窗：預設 settings.dayWindow；晚出門日（旅程第 lateStartFromDay 天起、非一日遊）起點改 lateStartHM；早起日由 day.earlyDay 自帶出門時刻。 */
export function dayWindow(day, index, settings) {
  const [start, end] = (settings.dayWindow ?? ['09:00', '24:00']).map(hmToMin);
  let startMin = start;
  if (day.earlyDay && day.departHM) startMin = hmToMin(day.departHM);
  else if (!day.earlyDay && day.type === 'normal' && index + 1 >= (settings.lateStartFromDay ?? 3) && !day.dayTrip) startMin = hmToMin(settings.lateStartHM ?? '11:00');
  if (day.type === 'arrival' && day.arriveMin != null) startMin = Math.max(startMin, day.arriveMin + (settings.arrivalBufferMin ?? 60));
  let endMin = end;
  if (day.type === 'departure' && day.departAirportMin != null) endMin = Math.min(endMin, day.departAirportMin - (settings.departureBufferMin ?? 180));
  return { startMin, endMin };
}

/** 當日區域（第一版）：據點的 Zone ＋ 主行程的 Zone ＋ 所有候選的 Zone；之後換成據點圈 ∪ 錨點圈 ∪ 走廊。 */
export function regionZonesOf({ home, candidates, anchorPoi }) {
  const z = new Set([home?.zoneId, anchorPoi?.zoneId, ...candidates.map((c) => c.poi.zoneId)].filter(Boolean));
  return [...z];
}

/**
 * planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool, options }) → { days: [{ date, day, plan }], warnings }
 * - trip.days[]: { date, type, earlyDay, departHM?, dayTrip?, anchor?: { poiId } | { theme, poiIds[] }, picks: [{ poiId, priority, dwellMin?, fixedWindow? }], designated?: [poiId], nightSlotOff?, removed?: [{ poiId, insertedBy? }] }
 *   removed 帶 insertedBy 'engine' ＝ 他拒絕過引擎插的站：那天不再插（profile §2.4 細則「拒絕＝跳過，不觸發改案、不罰、當天不再重插，連跑警告降成提示」）
 * - pois：{ [poiId]: poi }（已 normalize）
 * - restPool：引擎可插的站的來源（已規範化的 POI 陣列，可空；畫面與報告傳整個知識庫），每天由 restCandidates（恢復站）與 fillCandidates（填空檔，任何站）篩
 */
export function planTrip({ trip, pois, rules, settings, country, kb, legFn, restPool = [], options = {} }) {
  const out = []; const warnings = [];
  let prevTheme = null; let prevType = null;
  // 任何一天勾了的站（含主行程）不再當恢復站插：他勾的站由 picks 走
  const pickedAnywhere = new Set(trip.days.flatMap((d) => [...(d.picks ?? []).map((p) => p.poiId), d.anchor?.poiId, ...(d.anchor?.poiIds ?? [])]).filter(Boolean));
  trip.days.forEach((d, index) => {
    const home = resolveHome(trip, d.date);
    const candidates = (d.picks ?? []).map((p) => {
      const poi = pois[p.poiId];
      if (!poi) { warnings.push({ code: 'pick-unknown', date: d.date, msg: `${d.date} 的 ${p.poiId} 不在知識庫` }); return null; }
      return { poi, priority: p.priority ?? 'want', dwellMin: p.dwellMin, fixedWindow: p.fixedWindow ?? null, designated: (d.designated ?? []).includes(p.poiId), isAnchor: d.anchor?.poiId === p.poiId || Boolean(d.anchor?.poiIds?.includes(p.poiId)) };
    }).filter(Boolean);
    // 主行程：單站型用那站；主題型用骨架店的第一家當顯示名（畫面不得露出 theme 鍵值）
    const anchorPoi = d.anchor?.poiId ? pois[d.anchor.poiId] : (d.anchor?.poiIds?.length ? pois[d.anchor.poiIds[0]] : null);
    const themeCategory = d.anchor?.theme ?? null;
    const day = {
      date: d.date, type: d.type ?? 'normal', earlyDay: Boolean(d.earlyDay), party: trip.party ?? 1,
      dayTripNext: prevType === 'daytrip' || Boolean(trip.days[index - 1]?.dayTrip),
      themeCategory, prevThemeCategory: prevTheme,
      anchorPoiId: anchorPoi?.id ?? null, anchorName: anchorPoi?.name_zh ?? d.anchor?.theme ?? null,
      designated: d.designated ?? [], regionZones: regionZonesOf({ home, candidates, anchorPoi }),
      window: dayWindow(d, index, settings), nightSlotOff: Boolean(d.nightSlotOff) || Boolean(trip.days[index + 1]?.earlyDay),
    };
    // 先照他勾的排；走路連跑破表或等開門超過留白（REST_TRIGGER_RULES 的警告）才把恢復站加進候選重排一次，有比較好才採用。
    // 不每天都加：價值 0 的候選不受上界剪枝，試走包的 8/15 一加就從 276 節點變 6 萬節點、撞 800 ms 預算（2026-10-11 實測），結果還一樣。
    // 他拒絕過引擎插的站那天不跑第二趟（原話 #126；profile §2.4「當天不再重插，連跑警告降成提示」）：觸發的警告標 hint，畫面用提示樣式。
    let plan = planDay({ candidates, day, home, legFn, rules, settings, country, kb, options });
    const triggered = plan.warnings.some((w) => REST_TRIGGER_RULES.has(w.ruleId));
    if (triggered && rejectedRest(d.removed)) {
      plan = { ...plan, warnings: plan.warnings.map((w) => (REST_TRIGGER_RULES.has(w.ruleId) ? { ...w, hint: true } : w)) };
    } else if (triggered) {
      const rests = plan.warnings.some((w) => w.ruleId === 'walk-run') ? restCandidates({ restPool, candidates, day, removed: d.removed, pickedAnywhere, home, settings }) : [];
      const fillers = plan.warnings.some((w) => w.ruleId === 'wait-at-door') ? fillCandidates({ restPool, candidates, day, removed: d.removed, pickedAnywhere, home, plan, settings }) : [];
      const seen = new Set(rests.map((c) => c.poi.id));
      const extra = [...rests, ...fillers.filter((c) => (seen.has(c.poi.id) ? false : (seen.add(c.poi.id), true)))];
      if (extra.length) {
        const withRests = planDay({ candidates: [...candidates, ...extra], day, home, legFn, rules, settings, country, kb, options });
        if ((withRests.complete && !plan.complete) || (withRests.complete === plan.complete && withRests.score > plan.score)) plan = withRests;
      }
    }
    out.push({ date: d.date, day, plan });
    prevTheme = themeCategory; prevType = d.dayTrip ? 'daytrip' : (d.type ?? 'normal');
  });
  return { days: out, warnings };
}

/**
 * 引擎可插的恢復站（DESIGN §1.3：走路連跑要破 150 才由引擎插恢復站，來源＝候選池未勾 ∪ 當日區域 KB，標引擎插的、可拒絕）。
 * restPool 裡 recovery 的站、在當日區域內、沒被任何一天勾選、沒被這天拒絕過（d.removed）；
 * 依到當天 picks 座標重心的直線距離取最近的 settings.restPoolMax 家（picks 都沒座標就以住宿為中心；沒座標的站排最後）。
 * 價值 0（priority 'rest'）、optional：排不進不算落選；排進去的 stop 帶 insertedBy: 'engine'，畫面上「不去了」就進 removed。
 */
export function restCandidates({ restPool = [], candidates = [], day, removed = [], pickedAnywhere = new Set(), home = null, settings = {} }) {
  if (!restPool.length) return [];
  const removedIds = new Set(removed.map((r) => r.poiId));
  const center = centroidOf(candidates.map((c) => c.poi)) ?? (hasCoords(home) ? { lat: home.lat, lng: home.lng } : null);
  const distance = (p) => (center && hasCoords(p) ? haversineM(center, p) : Infinity);
  return restPool
    // 錢湯／日歸溫泉要準備（毛巾、換洗，profile §5.9），引擎不自己插；他勾了才會在 picks 裡
    .filter((p) => p && p.recovery === true && p.category !== 'onsen' && (day.regionZones ?? []).includes(p.zoneId) && !pickedAnywhere.has(p.id) && !removedIds.has(p.id))
    .map((p) => ({ p, d: distance(p) }))
    .sort((a, b) => (a.d === b.d ? 0 : a.d < b.d ? -1 : 1))
    .slice(0, settings.restPoolMax ?? 6)
    .map(({ p }) => ({ poi: p, priority: 'rest', optional: true, insertedBy: 'engine', dwellMin: p.dwellMin ?? Math.max(settings.restResetMin ?? 30, 30) }));
}

/**
 * 填等開門空檔的候選（原話 #161「任何站都可以」）：restPool 裡不是交通、活動、錢湯的站，在當日區域內、沒被任何一天勾選、沒被這天拒絕過；
 * 每個等開門警告（帶 poiId）找那站與它前一站（沒有就住宿）的中點，取離中點最近的 settings.fillPoolMax 家。
 * 價值 0（priority 'filler'）、optional、insertedBy 'engine'；排進去就是「引擎排進來填空檔的站」，可拒絕。
 */
export function fillCandidates({ restPool = [], candidates = [], day, removed = [], pickedAnywhere = new Set(), home = null, plan, settings = {} }) {
  if (!restPool.length || !plan?.sequence?.length) return [];
  const removedIds = new Set(removed.map((r) => r.poiId));
  const pool = restPool.filter((p) => p && !NO_FILL_CATEGORIES.has(p.category) && (day.regionZones ?? []).includes(p.zoneId) && !pickedAnywhere.has(p.id) && !removedIds.has(p.id));
  const out = new Map();
  for (const w of plan.warnings.filter((x) => x.ruleId === 'wait-at-door' && x.poiId)) {
    const i = plan.sequence.findIndex((s) => s.poi.id === w.poiId);
    if (i < 0) continue;
    const waiting = plan.sequence[i].poi; const before = i > 0 ? plan.sequence[i - 1].poi : home;
    const mid = centroidOf([waiting, before].filter(Boolean)) ?? centroidOf(candidates.map((c) => c.poi));
    const distance = (p) => (mid && hasCoords(p) ? haversineM(mid, p) : Infinity);
    pool.map((p) => ({ p, d: distance(p) })).sort((a, b) => (a.d === b.d ? 0 : a.d < b.d ? -1 : 1)).slice(0, settings.fillPoolMax ?? 6)
      .forEach(({ p }) => { if (!out.has(p.id)) out.set(p.id, { poi: p, priority: 'filler', optional: true, insertedBy: 'engine', dwellMin: p.dwellMin ?? settings.defaultDwellMin ?? 60 }); });
  }
  return [...out.values()];
}

// 填空檔不拿的店型：交通與資訊（不是地點）、活動（綁日期）、錢湯（要準備，profile §5.9）
const NO_FILL_CATEGORIES = new Set(['logistics', 'event', 'onsen']);

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/** 這天有沒有拒絕過引擎插的站（規劃頁「不去了」把 stop.insertedBy 記進 removed）。 */
const rejectedRest = (removed = []) => removed.some((r) => r?.insertedBy === 'engine');

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
