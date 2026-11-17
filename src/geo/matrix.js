// 站對站的移動：先查知識庫的 walk.json（Valhalla 算的、含坡度），沒有才用直線距離 ×1.3 ÷ 80 m/分（DESIGN §4）並記警告。
// 回傳給引擎的 leg：{ walkMin, rideMin, climbMin, mode, source }。
// 搭車段（跨區的 rideMin）由 zones[].links 提供：直達沒有就找轉乘一次（A→某區→B）；這裡只管步行與要不要改搭車。
// 末班車（11-06；原話 #190）：連結可帶 "last": { "<出發區 id>": "HH:MM" }（從那一區往另一端的末班發車時刻）。搭車的 leg 用到的連結有這個方向的末班資料時多帶
// last: { leaveByMin, departMin, fromZoneId }（最晚幾分要離開起點、卡住的那一班幾分發車、從哪一區發車）；沒資料就沒有這個鍵。
// 引擎核心會把 leg 規範化成固定幾個欄位（engine/core.js normalizeLeg），規則拿不到 leg.last，所以另給兩個查表用的方法（engine/trip.js 每天整理成 day.lastLegs、day.away）：
// legFn.linkBetween(起區, 訖區, 日別)、legFn.rideLink(起點, 終點, 日別)。
// 分日別（11-06 第二批）：末班的值也可以寫 { "weekday": "HH:MM", "saturday": "HH:MM", "holiday": "HH:MM" }——公車平日、週六、日祝常常不是同一班
// （秋保 西部ライナー 平日與週六 21:01、日祝 19:18）。那天是哪一種由 serviceDayOf(日期, 國家層) 算，查表的兩個方法吃它當第三個參數；
// 不知道是哪一天（legFn(from, to) 本身不帶日期）、落在特殊時刻表期間、或那一種沒寫，都取有寫的裡面最早的一班（保守）。寫成單一 "HH:MM" 的每天同一個值，行為跟分日別之前一樣。

const R = 6371000;
export function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 凌晨幾點以前的末班時刻算隔天（00:12 的末班車是 24:12；推導：營運日不會在凌晨四點前換日）。 */
const LAST_ROLLOVER_MIN = 4 * 60;
/** 末班分日別的三個鍵：平日、週六、週日與假日（日本時刻表的 平日／土曜／日祝）。 */
export const SERVICE_DAYS = Object.freeze(['weekday', 'saturday', 'holiday']);

/** "HH:MM" → 當天 00:00 起算的分鐘（04:00 以前的算隔天）；不是這個格式回 null。 */
function lastHmToMin(hm) {
  const m = typeof hm === 'string' ? hm.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < LAST_ROLLOVER_MIN ? min + 1440 : min;
}

/**
 * 那一天跑哪一種時刻表（末班分日別用）：週六 'saturday'、週日 'holiday'、其餘 'weekday'；
 * 日期落在國家層列的特殊時刻表期間回 'special'——country.transportProfile.specialSchedule: [{ name, from: "MM-DD", to: "MM-DD" }]（選填；盂蘭盆、年末年始這種
 * 業者會改跑別種時刻表、又查不到公告的期間；頭尾都含，from 比 to 晚＝跨年；沒有這一欄就沒有特殊期間，寫壞的那幾筆跳過）；日期看不懂回 null。
 * 'special' 與 null 都讓 lastDepartMin 取有寫的裡面最早的一班（保守）。
 * 已知的缺口：落在平日的國定假日（國家層沒有逐日的假日表）照 'weekday' 算；要保守就把那一天寫進 specialSchedule（from 與 to 同一天）。
 */
export function serviceDayOf(date, country = null) {
  const m = typeof date === 'string' ? date.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (at.getUTCMonth() !== Number(m[2]) - 1 || at.getUTCDate() !== Number(m[3])) return null;   // 02-30 這種不存在的日期
  const md = `${m[2]}-${m[3]}`;
  const special = country?.transportProfile?.specialSchedule;
  if (Array.isArray(special)) {
    for (const s of special) {
      const from = typeof s?.from === 'string' && /^\d{2}-\d{2}$/.test(s.from) ? s.from : null;
      const to = typeof s?.to === 'string' && /^\d{2}-\d{2}$/.test(s.to) ? s.to : null;
      if (!from || !to) continue;
      if (from <= to ? (md >= from && md <= to) : (md >= from || md <= to)) return 'special';
    }
  }
  const dow = at.getUTCDay();
  return dow === 6 ? 'saturday' : dow === 0 ? 'holiday' : 'weekday';
}

/**
 * 連結上「從 zoneId 往另一端」的末班發車時刻（當天 00:00 起算的分鐘）；沒寫、寫壞回 null（＝這個方向沒有末班資料，不判）。
 * link.last[zoneId] 兩種寫法：
 * - "HH:MM"：每天同一班。
 * - { weekday, saturday, holiday }（各 "HH:MM"，可以只寫其中幾個）：serviceDay（serviceDayOf 算的那一天的日別）有寫就用那一班；
 *   沒給 serviceDay、是 'special'（特殊時刻表期間）、或那一種沒寫／寫壞，取有寫的裡面最早的一班（保守）；三個都沒有可用的值回 null。
 * 過了午夜的班次寫 "00:12" 或 "24:12" 都行，04:00 以前的一律加 24 小時（比早晚時也照加過的算）。
 */
export function lastDepartMin(link, zoneId, serviceDay = null) {
  const v = link?.last?.[zoneId];
  if (typeof v === 'string') return lastHmToMin(v);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const exact = SERVICE_DAYS.includes(serviceDay) ? lastHmToMin(v[serviceDay]) : null;
  if (exact != null) return exact;
  const all = SERVICE_DAYS.map((k) => lastHmToMin(v[k])).filter((x) => x != null);
  return all.length ? Math.min(...all) : null;
}

/**
 * makeLegFn({ walk, settings, zoneLinks, fallbackMin }) → legFn(from, to)
 * - walk：walk.json 的 pairs（"a|b" → { min, m }）
 * - zoneLinks：{ "<zoneA>|<zoneB>": { rideMin, walkMin, last? } } 跨區搭車（可空）；last 見檔頭
 * - 兩邊都沒座標：同區用 fallbackMin.sameZone（預設 10），跨區 fallbackMin.crossZone（預設 20）
 * legFn 另帶：
 * - legFn.linkBetween(zoneA, zoneB, serviceDay?) → 兩區之間的搭車連結 { rideMin, walkMin, mode, hops, total, via?, last? }（直達優先、沒有就轉乘一次），沒有回 null。
 *   last 是 zoneA→zoneB 這個方向的：直達＝那條連結從 zoneA 發車的末班，leaveByMin＝發車時刻 − 連結的 walkMin（走去搭車的分鐘全算在上車前，保守）；
 *   轉乘一次（A→轉乘區→B）兩段各算——第一段同直達，第二段的最晚離開時刻＝轉乘區的末班發車 − 第一段的走路與車程 − 第二段的走路——取比較早的那個（先卡住的那一班）。
 *   serviceDay＝那一天的日別（serviceDayOf；末班分日別時用哪一班，見 lastDepartMin）；不給就取最早的一班。
 * - legFn.rideLink(from, to, serviceDay?) → 這一段照 legFn 的判斷會搭車（走路超過 walkVsRideMaxWalkMin、或沒座標只有連結；走路連結不算）就回那條連結（同 linkBetween），不然回 null；不記估算警告。
 * legFn(from, to) 回的 leg 上的 last 不知道是哪一天，一律是最早的那一班（引擎不讀它——核心會把 leg 規範化掉；要準的用上面兩個方法帶日別查）。
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
  /**
   * 兩區之間的搭車連結：直達優先；沒有就找轉乘一次（A→某區→B，取總分鐘最少）。zones.json 只寫直達，轉乘由這裡推（10-13 七天實驗：鹽竈→一番町沒直達，引擎算成走 203 分）。
   * serviceDay 只影響連結上的 last（分日別的末班取哪一班）；路怎麼走、幾分鐘不看它。快取連日別一起當鍵（最多四種：三種日別＋不知道／特殊期間）。
   */
  const linkBetween = (za, zb, serviceDay = null) => {
    if (!za || !zb || za === zb) return null;
    const dayKey = SERVICE_DAYS.includes(serviceDay) ? serviceDay : null;
    const cacheKey = `${za}|${zb}|${dayKey ?? ''}`;
    if (linkCache.has(cacheKey)) return linkCache.get(cacheKey);
    const direct = zoneLinks[`${za}|${zb}`] ?? zoneLinks[`${zb}|${za}`];
    let best = direct ? { rideMin: direct.rideMin ?? 0, walkMin: direct.walkMin ?? 5, mode: direct.mode ?? 'ride', hops: 1, total: (direct.rideMin ?? 0) + (direct.walkMin ?? 5) } : null;
    if (best) {
      const last = lastOf(lastDepartMin(direct, za, dayKey), best.walkMin, za);
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
        const c1 = lastOf(lastDepartMin(l1, za, dayKey), l1.walkMin ?? 5, za);
        const c2 = lastOf(lastDepartMin(l2, hub, dayKey), (l1.walkMin ?? 5) + (l1.rideMin ?? 0) + (l2.walkMin ?? 5), hub);
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
  legFn.linkBetween = (za, zb, serviceDay = null) => { const link = linkBetween(za, zb, serviceDay); return link ? { ...link } : null; };
  legFn.rideLink = (from, to, serviceDay = null) => {
    const leg = route(from, to, true);
    return leg.source === 'link' && leg.rideMin > 0 ? legFn.linkBetween(from?.zoneId, to?.zoneId, serviceDay) : null;
  };
  return legFn;
}

const hasCoords = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
