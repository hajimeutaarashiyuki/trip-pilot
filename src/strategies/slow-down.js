// 降速（累了／腳痛同一顆鍵，原話 #115）：先坐一下，再砍要走路的站（係數 ≥0.5 且非 must），逛店連跑上限減半，縮步行（走路上限 ×slowDownWalkFactor）。
// 先坐一下＝剩下的站裡 30 分內進得去的恢復站（最近那家）釘到最前面；沒有才從 pool 插一家：有坐下的、現在出發到門口時進得去、
// 離現在位置最近（咖啡廳最優先，profile §5.9），他可以在畫面上拒絕（原話 #126）。
// 釘＝fixedWindow 設成「現在出發就到」的時刻、帶 pinned：核心只看分數，不釘的話會把恢復站排到別的位置（2026-10-12 試走包實測：
// 8/13 12:50 插進來的喫茶被排到 17:51、8/17 13:00 星山珈琲店排在 SEGA-RU 後面），「先坐一下」就不是先了；釘只對這一次改案有效，
// 現場頁再重排時把 pinned 的拿掉（ui/applied.js remainingFrom）。只坐一下（rest-only）共用這裡的挑法。
import { openIntervals } from '../engine/time.js';

/** 剩下的恢復站有沒有一家「現在起 soonMin 分內進得去」的；hours 不明的當進得去。 */
export function restSoon(candidates, day, nowMin, soonMin) {
  const at = nowMin + soonMin;
  return candidates.some((c) => {
    if (!c.poi.recovery) return false;
    const iv = openIntervals(c.poi, day?.date);
    if (iv === null) return true;
    return iv.some(([o, cl]) => at >= o && at < cl);
  });
}

/** atMin 到的時候有開、待 dwellMin 分待得完；hours 不明當有開。 */
function openAt(poi, date, atMin, dwellMin) {
  const iv = openIntervals(poi, date);
  if (iv === null) return true;
  return iv.some(([o, cl]) => atMin >= o && atMin + dwellMin <= cl);
}

/** 現在出發到這站的分鐘（走路＋搭車＋等車，跟 schedule.js 算到達的方法一樣；差一分釘的時刻就會被 fixed-window 判 never）。 */
function travelTo(legFn, here, poi) {
  const leg = legFn(here, poi) ?? {};
  return num(leg.walkMin) + num(leg.rideMin) + num(leg.waitMin);
}

/**
 * 從 pool 挑一家「現在就去坐」的恢復站：recovery、不在 remaining 裡、現在出發到門口時有開而且待得完、最近（咖啡廳扣 5 分優先一點點）。
 * 回 planDay 的候選：priority want（他按了累了，這站是要的）、optional（排不進不算落選、不佔名額）、insertedBy engine、
 * fixedWindow 釘在到達時刻（pinned）；挑不到回 null。
 */
export function pickRestNow({ remaining, here, legFn, pool = [], settings, day, nowMin = 0 }) {
  let pick = null; let pickScore = Infinity;
  for (const c of pool) {
    if (!c.poi.recovery || remaining.some((r) => r.poi.id === c.poi.id)) continue;
    const travel = travelTo(legFn, here, c.poi);
    const dwellMin = c.dwellMin ?? Math.max(settings.restResetMin ?? 30, 30);
    if (!openAt(c.poi, day?.date, nowMin + travel, dwellMin)) continue;
    const score = travel - (c.poi.cafeLike ? 5 : 0);
    if (score < pickScore) { pickScore = score; pick = { ...c, priority: 'want', optional: true, insertedBy: 'engine', dwellMin, fixedWindow: { startMin: nowMin + travel, pinned: true } }; }
  }
  return pick;
}

/**
 * 剩下的站裡最近、現在出發到了就進得去的恢復站釘到最前面（先坐一下；咖啡廳扣 5 分優先一點點，跟 pickRestNow 同一套——
 * 純照最近釘會釘到牛舌店，2026-10-12 試走包 8/13 15:00 實測比釘珈巣多夢多罰 54 分）；本來就有固定時段的（訂位那種）不動。
 * 回 { candidates, pinned }：pinned 是釘了的那站（null＝沒釘）。
 */
function pinNearestRest(candidates, { here, legFn, settings, day, nowMin }) {
  let best = null; let bestScore = Infinity; let bestTravel = 0;
  for (const c of candidates) {
    if (!c.poi.recovery || c.fixedWindow) continue;
    const travel = travelTo(legFn, here, c.poi);
    const dwellMin = c.dwellMin ?? c.poi.dwellMin ?? settings.defaultDwellMin ?? 60;
    if (!openAt(c.poi, day?.date, nowMin + travel, dwellMin)) continue;
    const score = travel - (c.poi.cafeLike ? 5 : 0);
    if (score < bestScore) { bestScore = score; bestTravel = travel; best = c; }
  }
  if (!best) return { candidates, pinned: null };
  const pinned = { ...best, fixedWindow: { startMin: nowMin + bestTravel, pinned: true } };
  return { candidates: candidates.map((c) => (c === best ? pinned : c)), pinned };
}

const num = (v) => (Number.isFinite(v) ? v : 0);

export default {
  id: 'slow-down',
  label: '先坐一下，少走路',
  apply(input) {
    const { remaining, settings, day, nowMin = 0 } = input;
    const changes = [];
    let candidates = remaining.filter((c) => {
      const keep = c.priority === 'must' || (c.poi.walkFactor ?? 0) < 0.5 || c.poi.recovery;
      if (!keep) changes.push({ poiId: c.poi.id, action: 'cut', why: '要走路的站' });
      return keep;
    });
    const cut = changes.length > 0;
    const hasRest = restSoon(candidates, day, nowMin, settings.restSoonMin ?? 30);
    let inserted = null; let pinned = null;
    if (hasRest) {
      ({ candidates, pinned } = pinNearestRest(candidates, input));
    } else {
      inserted = pickRestNow(input);
      if (inserted) {
        candidates = [inserted, ...candidates];
        changes.push({ poiId: inserted.poi.id, action: 'insert-rest' });
      }
    }
    // 縮步行（DESIGN §1.4 策略 5）：走路上限乘 settings.slowDownWalkFactor（預設 0.7，跟早起日同值），重排時 walk-budget 就會把走路多的站往後擺或砍掉
    const walkBudgetMin = Math.floor((settings.walkBudgetMin ?? 150) * (settings.slowDownWalkFactor ?? 0.7));
    // 一句話要對得上真的做了什麼：坐哪裡（插的／釘的／留著的／沒有）＋砍了沒＋走路上限
    const sat = Boolean(inserted || pinned);
    const sit = inserted ? '先找最近的地方坐一下' : pinned ? '先去坐下來的那站' : hasRest ? '坐下來的那站留著' : '附近沒有進得去的恢復站';
    const rest = cut ? `${sat ? '，再' : '；'}砍掉要走路的站，逛店也少一半` : '；剩下的沒有要走路的站，逛店少一半';
    return {
      candidates,
      changes,
      settingsPatch: { maxShopRunCount: Math.max(1, Math.floor((settings.maxShopRunCount ?? 4) / 2)), maxShopRunMin: Math.floor((settings.maxShopRunMin ?? 240) / 2), walkBudgetMin },
      note: `${sit}${rest}，走路上限降到 ${walkBudgetMin} 分`,
    };
  },
};
