// 站對站的移動：先查知識庫的 walk.json（Valhalla 算的、含坡度），沒有才用直線距離 ×1.3 ÷ 80 m/分（DESIGN §4）並記警告。
// 回傳給引擎的 leg：{ walkMin, rideMin, climbMin, mode, source }。
// 搭車段（跨區的 rideMin）由 zones[].links 提供：直達沒有就找轉乘一次（A→某區→B）；這裡只管步行與要不要改搭車。
// 末班車（11-06；原話 #190）：連結可帶 "last": { "<出發區 id>": "HH:MM" }（從那一區往另一端的末班發車時刻）。搭車的 leg 用到的連結有這個方向的末班資料時多帶
// last: { leaveByMin, departMin, fromZoneId }（最晚幾分要離開起點、卡住的那一班幾分發車、從哪一區發車）；沒資料就沒有這個鍵。
// 引擎核心會把 leg 規範化成固定幾個欄位（engine/core.js normalizeLeg），規則拿不到 leg.last，所以另給兩個查表用的方法（engine/trip.js 每天整理成 day.lastLegs、day.away）：
// legFn.linkBetween(起區, 訖區)、legFn.rideLink(起點, 終點)。

const R = 6371000;
export function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 凌晨幾點以前的末班時刻算隔天（00:12 的末班車是 24:12；推導：營運日不會在凌晨四點前換日）。 */
const LAST_ROLLOVER_MIN = 4 * 60;
/**
 * 連結上「從 zoneId 往另一端」的末班發車時刻（當天 00:00 起算的分鐘）：link.last[zoneId] 寫 "HH:MM"；沒寫、寫壞回 null（＝這個方向沒有末班資料，不判）。
 * 過了午夜的班次寫 "00:12" 或 "24:12" 都行，04:00 以前的一律加 24 小時。
 */
export function lastDepartMin(link, zoneId) {
  const hm = link?.last?.[zoneId];
  const m = typeof hm === 'string' ? hm.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < LAST_ROLLOVER_MIN ? min + 1440 : min;
}

/**
 * makeLegFn({ walk, settings, zoneLinks, fallbackMin }) → legFn(from, to)
 * - walk：walk.json 的 pairs（"a|b" → { min, m }）
 * - zoneLinks：{ "<zoneA>|<zoneB>": { rideMin, walkMin, last? } } 跨區搭車（可空）；last 見檔頭
 * - 兩邊都沒座標：同區用 fallbackMin.sameZone（預設 10），跨區 fallbackMin.crossZone（預設 20）
 * legFn 另帶：
 * - legFn.linkBetween(zoneA, zoneB) → 兩區之間的搭車連結 { rideMin, walkMin, mode, hops, total, via?, last? }（直達優先、沒有就轉乘一次），沒有回 null。
 *   last 是 zoneA→zoneB 這個方向的：直達＝那條連結從 zoneA 發車的末班，leaveByMin＝發車時刻 − 連結的 walkMin（走去搭車的分鐘全算在上車前，保守）；
 *   轉乘一次（A→轉乘區→B）兩段各算——第一段同直達，第二段的最晚離開時刻＝轉乘區的末班發車 − 第一段的走路與車程 − 第二段的走路——取比較早的那個（先卡住的那一班）。
 * - legFn.rideLink(from, to) → 這一段照 legFn 的判斷會搭車（走路超過 walkVsRideMaxWalkMin、或沒座標只有連結；走路連結不算）就回那條連結（同 linkBetween），不然回 null；不記估算警告。
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
  /** 一班末班車換成「最晚幾分要離開起點」；沒有這班的資料回 null。凍結後整個 legFn 共用同一個物件。 */
  const lastOf = (departMin, beforeMin, fromZoneId) => (departMin == null ? null : Object.freeze({ leaveByMin: departMin - beforeMin, departMin, fromZoneId }));
  /** 兩區之間的搭車連結：直達優先；沒有就找轉乘一次（A→某區→B，取總分鐘最少）。zones.json 只寫直達，轉乘由這裡推（10-13 七天實驗：鹽竈→一番町沒直達，引擎算成走 203 分）。 */
  const linkBetween = (za, zb) => {
    if (!za || !zb || za === zb) return null;
    const cacheKey = `${za}|${zb}`;
    if (linkCache.has(cacheKey)) return linkCache.get(cacheKey);
    const direct = zoneLinks[`${za}|${zb}`] ?? zoneLinks[`${zb}|${za}`];
    let best = direct ? { rideMin: direct.rideMin ?? 0, walkMin: direct.walkMin ?? 5, mode: direct.mode ?? 'ride', hops: 1, total: (direct.rideMin ?? 0) + (direct.walkMin ?? 5) } : null;
    if (best) {
      const last = lastOf(lastDepartMin(direct, za), best.walkMin, za);
      if (last) best.last = last;
    } else {
      for (const [key, l1] of Object.entries(zoneLinks)) {
        const [p, q] = key.split('|');
        const hub = p === za ? q : q === za ? p : null;
        if (!hub || hub === zb) continue;
        const l2 = zoneLinks[`${hub}|${zb}`] ?? zoneLinks[`${zb}|${hub}`];
        if (!l2) continue;
        const total = (l1.rideMin ?? 0) + (l1.walkMin ?? 5) + (l2.rideMin ?? 0) + (l2.walkMin ?? 5);
        if (best && total >= best.total) continue;
        best = { rideMin: (l1.rideMin ?? 0) + (l2.rideMin ?? 0), walkMin: (l1.walkMin ?? 5) + (l2.walkMin ?? 5), mode: `${l1.mode ?? 'ride'}+${l2.mode ?? 'ride'}`, via: hub, hops: 2, total };
        // 末班：第一段從起區發車、第二段從轉乘區發車；各自換成「最晚幾分要離開起點」，取先卡住的那一班
        const c1 = lastOf(lastDepartMin(l1, za), l1.walkMin ?? 5, za);
        const c2 = lastOf(lastDepartMin(l2, hub), (l1.walkMin ?? 5) + (l1.rideMin ?? 0) + (l2.walkMin ?? 5), hub);
        const last = c1 && c2 ? (c1.leaveByMin <= c2.leaveByMin ? c1 : c2) : (c1 ?? c2);
        if (last) best.last = last;
      }
    }
    linkCache.set(cacheKey, best);
    return best;
  };
  const ride = (link) => ({ walkMin: link.walkMin, rideMin: link.rideMin, climbMin: 0, mode: 'ride', source: 'link', ...(link.via ? { via: link.via } : {}), ...(link.last ? { last: link.last } : {}) });
  // 走路遠（超過 30 分）又有跨區搭車連結時改搭車；轉乘的只有比走路快才搭
  const rideBeats = (link, walkMin) => Boolean(link) && walkMin > maxWalk && (link.hops === 1 || link.total < walkMin);
  /** 這一段怎麼走（legFn 與 rideLink 共用，判斷只有這一份）。quiet：不記估算警告（rideLink 拿區中心的假站探路用）。 */
  const route = (from, to, quiet) => {
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
      if (!quiet) note(`${from.name_zh ?? from.id}→${to.name_zh ?? to.id} 沒有實算步行分鐘，用直線距離估`);
      return { walkMin: min, rideMin: 0, climbMin: 0, mode: 'walk', source: 'haversine' };
    }
    if (link) return ride(link);
    if (!quiet) note(`${from?.name_zh ?? from?.id}→${to?.name_zh ?? to?.id} 沒有座標，用區域預設分鐘`);
    return { walkMin: from?.zoneId === to?.zoneId ? same : cross, rideMin: 0, climbMin: 0, mode: 'walk', source: 'zone-default' };
  };
  const legFn = (from, to) => route(from, to, false);
  function note(msg) { if (warned.has(msg)) return; warned.add(msg); warnings.push({ code: 'leg-estimated', msg }); }
  legFn.warnings = warnings;
  legFn.linkBetween = (za, zb) => { const link = linkBetween(za, zb); return link ? { ...link } : null; };
  legFn.rideLink = (from, to) => {
    const leg = route(from, to, true);
    return leg.source === 'link' && leg.rideMin > 0 ? legFn.linkBetween(from?.zoneId, to?.zoneId) : null;
  };
  return legFn;
}

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
