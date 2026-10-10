// 站對站的移動：先查知識庫的 walk.json（Valhalla 算的、含坡度），沒有才用直線距離 ×1.3 ÷ 80 m/分（DESIGN §4）並記警告。
// 回傳給引擎的 leg：{ walkMin, rideMin, climbMin, mode, source }。
// 搭車段（跨區的 rideMin）由 zones[].links 提供；這裡只管步行。

const R = 6371000;
export function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * makeLegFn({ walk, settings, zoneLinks, fallbackMin }) → legFn(from, to)
 * - walk：walk.json 的 pairs（"a|b" → { min, m }）
 * - zoneLinks：{ "<zoneA>|<zoneB>": { rideMin, walkMin } } 跨區搭車（可空）
 * - 兩邊都沒座標：同區用 fallbackMin.sameZone（預設 10），跨區 fallbackMin.crossZone（預設 20）
 */
export function makeLegFn({ walk = {}, settings = {}, zoneLinks = {}, fallbackMin = {} } = {}) {
  const mPerMin = settings.walkingMPerMin ?? 80;
  const detour = settings.detourFactor ?? 1.3;
  const same = fallbackMin.sameZone ?? 10;
  const cross = fallbackMin.crossZone ?? 20;
  const warned = new Set();
  const warnings = [];
  const legFn = (from, to) => {
    const key = `${from?.id}|${to?.id}`;
    const link = zoneLinks[`${from?.zoneId}|${to?.zoneId}`] ?? zoneLinks[`${to?.zoneId}|${from?.zoneId}`];
    if (walk[key]) {
      const w = walk[key];
      // 走路遠（超過 30 分）又有跨區搭車連結時改搭車
      if (link && w.min > (settings.walkVsRideMaxWalkMin ?? 30)) return { walkMin: link.walkMin ?? 5, rideMin: link.rideMin, climbMin: 0, mode: 'ride', source: 'link' };
      return { walkMin: w.min, rideMin: 0, climbMin: 0, mode: 'walk', source: 'valhalla', m: w.m };
    }
    if (hasCoords(from) && hasCoords(to)) {
      const min = Math.ceil((haversineM(from, to) * detour) / mPerMin);
      if (link && min > (settings.walkVsRideMaxWalkMin ?? 30)) return { walkMin: link.walkMin ?? 5, rideMin: link.rideMin, climbMin: 0, mode: 'ride', source: 'link' };
      note(`${from.name_zh ?? from.id}→${to.name_zh ?? to.id} 沒有實算步行分鐘，用直線距離估`);
      return { walkMin: min, rideMin: 0, climbMin: 0, mode: 'walk', source: 'haversine' };
    }
    if (link) return { walkMin: link.walkMin ?? 5, rideMin: link.rideMin, climbMin: 0, mode: 'ride', source: 'link' };
    note(`${from?.name_zh ?? from?.id}→${to?.name_zh ?? to?.id} 沒有座標，用區域預設分鐘`);
    return { walkMin: from?.zoneId === to?.zoneId ? same : cross, rideMin: 0, climbMin: 0, mode: 'walk', source: 'zone-default' };
  };
  function note(msg) { if (warned.has(msg)) return; warned.add(msg); warnings.push({ code: 'leg-estimated', msg }); }
  legFn.warnings = warnings;
  return legFn;
}

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
