// 硬約束：白天站（原話 #159「這類型的限制在白天就好了 晚上黑漆漆的 要怎麼參觀」）。
// daylightOnly 的站（沒有營業時段的神社、寺院、靈廟、庭園、一日遊景點：derive/daylight.json 推、知識庫明寫優先）
// 只能排在「日出+margin 到日落−margin」之間；margin 是 settings.daylightMarginMin，跟 profile §3.1 同一組數字（check-rules 對帳）。
// 日出日落自己算（geo/sun.js，不接 API），時區讀國家層 country.utcOffsetMin（缺就跟其他缺欄位一樣由框架跳過並警告，不猜）；
// 位置依序取站的座標 → 該區中心 → 所有區中心的平均，都沒有就不擋（位置不明不罰）。
// 到的時候天已黑 → never（再往後只會更晚）；天還沒亮 → no（晚一點就亮了）；到時還亮但會待到天黑 → no（跟 hours 一樣，留給縮短停留的改案）。
import { daylightWindow } from '../geo/sun.js';
import { minToHm } from '../engine/time.js';

export default {
  id: 'daylight',
  kind: 'hard',
  reads: ['stop.poi.daylightOnly', 'stop.startMin', 'stop.endMin', 'day.date', 'country.utcOffsetMin'],
  defaults: {},
  apply(ctx) {
    if (ctx.stop.poi.daylightOnly !== true) return 'ok';
    const w = windowOf(ctx);
    if (!w) return 'ok';
    const { startMin, endMin } = ctx.stop;
    if (startMin >= w.endMin) return 'never';
    if (startMin < w.startMin) return 'no';
    return endMin <= w.endMin ? 'ok' : 'no';
  },
  warn(ctx) {
    const name = ctx.stop.poi.name_zh;
    const w = windowOf(ctx);
    if (!w) return `${name} 只能白天去`;
    const margin = marginOf(ctx);
    if (ctx.stop.startMin >= w.endMin) return `${name} 只能白天去，日落 ${minToHm(w.endMin + margin)}，${minToHm(ctx.stop.startMin)} 到的時候天已經黑了`;
    if (ctx.stop.startMin < w.startMin) return `${name} 只能白天去，日出 ${minToHm(w.startMin - margin)}，${minToHm(ctx.stop.startMin)} 到的時候天還沒亮`;
    return `${name} 只能白天去，日落 ${minToHm(w.endMin + margin)}，這樣待會待到天黑`;
  },
};

const marginOf = (ctx) => ctx.settings?.daylightMarginMin ?? 30;
const isNum = (v) => Number.isFinite(v);

/** 這一站的日照時窗；位置不明回 null。 */
function windowOf(ctx) {
  const at = positionOf(ctx);
  if (!at) return null;
  return daylightWindow(ctx.day.date, at, marginOf(ctx), ctx.country.utcOffsetMin);
}

/** 站的座標 → 該區中心 → 所有區中心的平均 → null。 */
function positionOf(ctx) {
  const poi = ctx.stop.poi;
  if (isNum(poi.lat) && isNum(poi.lng)) return { lat: poi.lat, lng: poi.lng };
  const zones = ctx.kb?.zones ?? {};
  const zone = poi.zoneId ? zones[poi.zoneId] : null;
  if (zone && isNum(zone.lat) && isNum(zone.lng)) return { lat: zone.lat, lng: zone.lng };
  const all = Object.values(zones).filter((z) => isNum(z?.lat) && isNum(z?.lng));
  if (!all.length) return null;
  return { lat: all.reduce((s, z) => s + z.lat, 0) / all.length, lng: all.reduce((s, z) => s + z.lng, 0) / all.length };
}
