// 換備案：把最遠的那一站換成它的備案裡最近的一家（DESIGN §1.4 策略 3）。備案來自 poi.alternatives[]（研究填）對到 pool。
// 沒有備案可換就回 null（這條策略不出案）。
export default {
  id: 'swap-alt',
  label: '最遠的那站換備案',
  apply({ remaining, here, legFn, pool = [] }) {
    const byId = new Map(pool.map((c) => [c.poi.id, c]));
    let farthest = null; let farMin = -1;
    for (const c of remaining) {
      if (c.priority === 'must' || !Array.isArray(c.poi.alternatives) || !c.poi.alternatives.length) continue;
      const leg = legFn(here, c.poi);
      const min = (leg.walkMin ?? 0) + (leg.rideMin ?? 0);
      if (min > farMin) { farMin = min; farthest = c; }
    }
    if (!farthest) return null;
    let best = null; let bestMin = Infinity;
    for (const altId of farthest.poi.alternatives) {
      const alt = byId.get(altId);
      if (!alt || remaining.some((c) => c.poi.id === altId)) continue;
      const leg = legFn(here, alt.poi);
      const min = (leg.walkMin ?? 0) + (leg.rideMin ?? 0);
      if (min < bestMin) { bestMin = min; best = alt; }
    }
    if (!best) return null;
    const candidates = remaining.map((c) => (c === farthest ? { ...best, priority: farthest.priority } : c));
    return { candidates, changes: [{ from: farthest.poi.id, to: best.poi.id }], note: `${farthest.poi.name_zh} 換成比較近的 ${best.poi.name_zh}` };
  },
};
