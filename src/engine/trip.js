// 整趟：把旅程的每一天交給 planDay（第一版：分天是他在規劃頁點的，引擎只排單日；決策樹 Q7）。
// 這裡負責把 Trip／Day 的資料翻成 planDay 要的 day 上下文：時窗、早起日、晚出門、主題、主行程、指定站、當日區域。
import { planDay } from './core.js';
import { hmToMin } from './time.js';

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
 * planTrip({ trip, pois, rules, settings, country, kb, legFn, options }) → { days: [{ date, day, plan }], warnings }
 * - trip.days[]: { date, type, earlyDay, departHM?, dayTrip?, anchor?: { poiId } | { theme, poiIds[] }, picks: [{ poiId, priority, dwellMin?, fixedWindow? }], designated?: [poiId], nightSlotOff? }
 * - pois：{ [poiId]: poi }（已 normalize）
 */
export function planTrip({ trip, pois, rules, settings, country, kb, legFn, options = {} }) {
  const out = []; const warnings = [];
  let prevTheme = null; let prevType = null;
  trip.days.forEach((d, index) => {
    const home = resolveHome(trip, d.date);
    const candidates = (d.picks ?? []).map((p) => {
      const poi = pois[p.poiId];
      if (!poi) { warnings.push({ code: 'pick-unknown', date: d.date, msg: `${d.date} 的 ${p.poiId} 不在知識庫` }); return null; }
      return { poi, priority: p.priority ?? 'want', dwellMin: p.dwellMin, fixedWindow: p.fixedWindow ?? null, designated: (d.designated ?? []).includes(p.poiId), isAnchor: d.anchor?.poiId === p.poiId || Boolean(d.anchor?.poiIds?.includes(p.poiId)) };
    }).filter(Boolean);
    const anchorPoi = d.anchor?.poiId ? pois[d.anchor.poiId] : null;
    const themeCategory = d.anchor?.theme ?? null;
    const day = {
      date: d.date, type: d.type ?? 'normal', earlyDay: Boolean(d.earlyDay), party: trip.party ?? 1,
      dayTripNext: prevType === 'daytrip' || Boolean(trip.days[index - 1]?.dayTrip),
      themeCategory, prevThemeCategory: prevTheme,
      anchorPoiId: anchorPoi?.id ?? null, anchorName: anchorPoi?.name_zh ?? d.anchor?.theme ?? null,
      designated: d.designated ?? [], regionZones: regionZonesOf({ home, candidates, anchorPoi }),
      window: dayWindow(d, index, settings), nightSlotOff: Boolean(d.nightSlotOff) || Boolean(trip.days[index + 1]?.earlyDay),
    };
    const plan = planDay({ candidates, day, home, legFn, rules, settings, country, kb, options });
    out.push({ date: d.date, day, plan });
    prevTheme = themeCategory; prevType = d.dayTrip ? 'daytrip' : (d.type ?? 'normal');
  });
  return { days: out, warnings };
}

function resolveHome(trip, date) {
  const bases = trip.homeBases ?? [];
  const hit = bases.find((b) => (!b.fromDate || b.fromDate <= date) && (!b.toDate || date <= b.toDate)) ?? bases[0];
  return hit?.poi ?? { id: 'home', name_zh: '住宿', zoneId: null };
}
