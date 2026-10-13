// 站對站的移動：先查知識庫的 walk.json（Valhalla 算的、含坡度），沒有才用直線距離 ×1.3 ÷ 80 m/分（DESIGN §4）並記警告。
// 回傳給引擎的 leg：{ walkMin, rideMin, climbMin, mode, source }。
// 搭車段（跨區的 rideMin）由 zones[].links 提供：直達沒有就找轉乘一次（A→某區→B）；這裡只管步行與要不要改搭車。

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
  const maxWalk = settings.walkVsRideMaxWalkMin ?? 30;
  const linkCache = new Map();
  /** 兩區之間的搭車連結：直達優先；沒有就找轉乘一次（A→某區→B，取總分鐘最少）。zones.json 只寫直達，轉乘由這裡推（10-13 七天實驗：鹽竈→一番町沒直達，引擎算成走 203 分）。 */
  const linkBetween = (za, zb) => {
    if (!za || !zb || za === zb) return null;
    const cacheKey = `${za}|${zb}`;
    if (linkCache.has(cacheKey)) return linkCache.get(cacheKey);
    const direct = zoneLinks[`${za}|${zb}`] ?? zoneLinks[`${zb}|${za}`];
    let best = direct ? { rideMin: direct.rideMin ?? 0, walkMin: direct.walkMin ?? 5, mode: direct.mode ?? 'ride', hops: 1, total: (direct.rideMin ?? 0) + (direct.walkMin ?? 5) } : null;
    if (!best) {
      for (const [key, l1] of Object.entries(zoneLinks)) {
        const [p, q] = key.split('|');
        const hub = p === za ? q : q === za ? p : null;
        if (!hub || hub === zb) continue;
        const l2 = zoneLinks[`${hub}|${zb}`] ?? zoneLinks[`${zb}|${hub}`];
        if (!l2) continue;
        const total = (l1.rideMin ?? 0) + (l1.walkMin ?? 5) + (l2.rideMin ?? 0) + (l2.walkMin ?? 5);
        if (!best || total < best.total) best = { rideMin: (l1.rideMin ?? 0) + (l2.rideMin ?? 0), walkMin: (l1.walkMin ?? 5) + (l2.walkMin ?? 5), mode: `${l1.mode ?? 'ride'}+${l2.mode ?? 'ride'}`, via: hub, hops: 2, total };
      }
    }
    linkCache.set(cacheKey, best);
    return best;
  };
  const ride = (link) => ({ walkMin: link.walkMin, rideMin: link.rideMin, climbMin: 0, mode: 'ride', source: 'link', ...(link.via ? { via: link.via } : {}) });
  // 走路遠（超過 30 分）又有跨區搭車連結時改搭車；轉乘的只有比走路快才搭
  const rideBeats = (link, walkMin) => Boolean(link) && walkMin > maxWalk && (link.hops === 1 || link.total < walkMin);
  const legFn = (from, to) => {
    const key = `${from?.id}|${to?.id}`;
    const link = linkBetween(from?.zoneId, to?.zoneId);
    if (walk[key]) {
      const w = walk[key];
      if (rideBeats(link, w.min)) return ride(link);
      return { walkMin: w.min, rideMin: 0, climbMin: 0, mode: 'walk', source: 'valhalla', m: w.m };
    }
    if (hasCoords(from) && hasCoords(to)) {
      const min = Math.ceil((haversineM(from, to) * detour) / mPerMin);
      if (rideBeats(link, min)) return ride(link);
      note(`${from.name_zh ?? from.id}→${to.name_zh ?? to.id} 沒有實算步行分鐘，用直線距離估`);
      return { walkMin: min, rideMin: 0, climbMin: 0, mode: 'walk', source: 'haversine' };
    }
    if (link) return ride(link);
    note(`${from?.name_zh ?? from?.id}→${to?.name_zh ?? to?.id} 沒有座標，用區域預設分鐘`);
    return { walkMin: from?.zoneId === to?.zoneId ? same : cross, rideMin: 0, climbMin: 0, mode: 'walk', source: 'zone-default' };
  };
  function note(msg) { if (warned.has(msg)) return; warned.add(msg); warnings.push({ code: 'leg-estimated', msg }); }
  legFn.warnings = warnings;
  return legFn;
}

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
