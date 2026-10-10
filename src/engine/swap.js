// 換這一站（DESIGN §6.3.1，原話 #90、#91）：點某一站，列出同類型、順路、那個時段有開的候選；換掉的站不算落選。
// 規劃頁與現場都用；候選來源＝候選池 ∪ 走廊清單 ∪ 當日區域內的知識庫（這裡統一收成 pool）。
import { openIntervals } from './time.js';

/**
 * swapCandidates({ plan, stopId, pool, legFn, date, settings }) → [{ poi, detourMin, open }]
 * - 同 category；餐段的站放寬到所有吃的類（food／bar／cafe）
 * - 順路：以前後站算 detourMin ＝ (前→候選＋候選→後) − (前→後)，≤ settings.swapDetourMaxMin（預設 10）
 * - 那個時段有開（hours 查得到的才判；查不到的列出來但標 open: null）
 */
export function swapCandidates({ plan, stopId, pool, legFn, date, settings = {} }) {
  const seq = plan.sequence;
  const i = seq.findIndex((s) => s.poi.id === stopId);
  if (i < 0) return [];
  const cur = seq[i]; const prev = seq[i - 1] ?? null; const next = seq[i + 1] ?? null;
  const maxDetour = settings.swapDetourMaxMin ?? 10;
  const eating = new Set(['food', 'bar', 'cafe']);
  const sameType = (p) => (eating.has(cur.poi.category) ? eating.has(p.category) : p.category === cur.poi.category);
  const inPlan = new Set(seq.map((s) => s.poi.id));
  const out = [];
  for (const c of pool) {
    const poi = c.poi ?? c;
    if (poi.id === cur.poi.id || inPlan.has(poi.id) || !sameType(poi)) continue;
    const a = prev ? legMin(legFn(prev.poi, poi)) : 0;
    const b = next ? legMin(legFn(poi, next.poi)) : 0;
    const base = prev && next ? legMin(legFn(prev.poi, next.poi)) : 0;
    const detourMin = Math.max(0, a + b - base);
    if (detourMin > maxDetour) continue;
    const iv = openIntervals(poi, date);
    const open = iv === null ? null : iv.some(([o, cl]) => cur.startMin >= o && cur.startMin + (poi.dwellMin ?? cur.dwellMin) <= cl);
    if (open === false) continue;
    out.push({ poi, detourMin, open });
  }
  out.sort((x, y) => x.detourMin - y.detourMin);
  return out;
}

/** 把旅程某天的 picks 裡的一站換成另一站（換掉的不算落選：記在 day.swapped[]），回新的 day 物件；重排由呼叫端做。 */
export function applySwap(day, fromPoiId, toPoi, priority = 'want') {
  const picks = (day.picks ?? []).map((p) => (p.poiId === fromPoiId ? { ...p, poiId: toPoi.id, priority: p.priority ?? priority } : p));
  const swapped = [...(day.swapped ?? []), { from: fromPoiId, to: toPoi.id, at: new Date().toISOString() }];
  return { ...day, picks, swapped };
}

const legMin = (l) => (l?.walkMin ?? 0) + (l?.rideMin ?? 0);
