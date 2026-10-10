// 畫面用的白天站時限：daylightOnly 的站沒有「幾點關」，改寫「天黑 HH:MM 前」（原話 #159）。
// 時窗跟 rules/daylight.js 同一套（geo/sun.js、settings.daylightMarginMin、country.utcOffsetMin）；
// 位置用站的座標、沒有就該區的區心，再沒有就回 null 不顯示（規則那邊還會退到所有區心的平均，畫面不跟：位置不明就不寫時間）；
// 時區沒有也回 null（不猜時區，跟規則缺欄位就跳過一樣）。
import { daylightWindow } from '../geo/sun.js';

const isNum = (v) => Number.isFinite(v);

/** darkBeforeMin(poi, date, { zones, marginMin, utcOffsetMin }) → 天黑前要離開的分鐘數（整數分，無條件捨去）；不是白天站、位置不明、沒時區都回 null。 */
export function darkBeforeMin(poi, date, { zones = {}, marginMin = 30, utcOffsetMin = null } = {}) {
  if (poi?.daylightOnly !== true || !date || !isNum(utcOffsetMin)) return null;
  const at = positionOf(poi, zones);
  if (!at) return null;
  return Math.floor(daylightWindow(date, at, marginMin, utcOffsetMin).endMin);
}

/** 從 App 狀態取參數：state.kb.zones、state.settings.daylightMarginMin、state.country.utcOffsetMin（沒有就 null → 不顯示）。 */
export function darkBeforeMinOf(poi, date, state) {
  return darkBeforeMin(poi, date, {
    zones: state?.kb?.zones ?? {},
    marginMin: state?.settings?.daylightMarginMin ?? 30,
    utcOffsetMin: state?.country?.utcOffsetMin ?? null,
  });
}

function positionOf(poi, zones) {
  if (isNum(poi.lat) && isNum(poi.lng)) return { lat: poi.lat, lng: poi.lng };
  const zone = poi.zoneId ? zones?.[poi.zoneId] : null;
  if (zone && isNum(zone.lat) && isNum(zone.lng)) return { lat: zone.lat, lng: zone.lng };
  return null;
}
