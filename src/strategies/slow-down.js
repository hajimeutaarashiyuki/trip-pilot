// 降速（累了／腳痛同一顆鍵，原話 #115）：先插恢復站，再砍要走路的站（係數 ≥0.5 且非 must），逛店連跑上限減半，縮步行。
// 恢復站從 pool 裡挑：有坐下的、離現在位置最近的一家（咖啡廳最優先，profile §5.9）；他可以在畫面上拒絕（原話 #126）。
import { openIntervals } from '../engine/time.js';

/** 剩下的恢復站有沒有一家「現在起 soonMin 分內進得去」的；hours 不明的當進得去。 */
function restSoon(candidates, day, nowMin, soonMin) {
  const at = nowMin + soonMin;
  return candidates.some((c) => {
    if (!c.poi.recovery) return false;
    const iv = openIntervals(c.poi, day?.date);
    if (iv === null) return true;
    return iv.some(([o, cl]) => at >= o && at < cl);
  });
}

export default {
  id: 'slow-down',
  label: '先坐一下，少走路',
  apply({ remaining, here, legFn, pool = [], settings, day, nowMin = 0 }) {
    const changes = [];
    let candidates = remaining.filter((c) => {
      const keep = c.priority === 'must' || (c.poi.walkFactor ?? 0) < 0.5 || c.poi.recovery;
      if (!keep) changes.push({ poiId: c.poi.id, action: 'cut', why: '要走路的站' });
      return keep;
    });
    const hasRest = restSoon(candidates, day, nowMin, settings.restSoonMin ?? 30);
    if (!hasRest) {
      const rests = pool.filter((c) => c.poi.recovery && !remaining.some((r) => r.poi.id === c.poi.id));
      let pick = null; let pickMin = Infinity;
      for (const c of rests) {
        const leg = legFn(here, c.poi);
        const min = (leg.walkMin ?? 0) + (leg.rideMin ?? 0) - (c.poi.cafeLike ? 5 : 0);   // 咖啡廳優先一點點
        if (min < pickMin) { pickMin = min; pick = c; }
      }
      if (pick) {
        candidates = [{ ...pick, priority: 'want', insertedBy: 'engine', dwellMin: pick.dwellMin ?? Math.max(settings.restResetMin ?? 30, 30) }, ...candidates];
        changes.push({ poiId: pick.poi.id, action: 'insert-rest' });
      }
    }
    return {
      candidates,
      changes,
      settingsPatch: { maxShopRunCount: Math.max(1, Math.floor((settings.maxShopRunCount ?? 4) / 2)), maxShopRunMin: Math.floor((settings.maxShopRunMin ?? 240) / 2) },
      note: hasRest ? '砍掉要走路的站，逛店也少一半' : '先找最近的地方坐一下，再砍掉要走路的站',
    };
  },
};
