// 硬約束：當天的時窗（出門到收工）。站的結束超過收工時刻＝never（再往後插只會更晚）。
// day.window.endMin 是扣過留白的收工時刻（trip.js dayWindow：留白排在最後，24:00 → 22:30）；原時窗在 day.windowRaw。
// 固定時段的站（stop.fixedWindow：演唱會、花火那種晚場）對原時窗比、不對扣過留白的收工比：留白是給現場落後吃的額度（profile §8、DESIGN §4 openSlotMin），
// 不該把一件釘死時刻的事整個擋掉（10-14 T23 審查：演唱會 19:00–22:15 加散場緩衝到 22:45，22:30 收工就 never、整天空的）；
// 釘起訖的站比的是散場時刻（endMin）本身，散場緩衝（afterMin）是「不排站」的時間、不是人要待到的時刻（推導）。沒有 windowRaw 的 day（舊形狀、規則測試）就照 window。
import { minToHm } from '../engine/time.js';

export default {
  id: 'window',
  kind: 'hard',
  reads: ['stop.endMin', 'day.window.endMin'],
  defaults: {},
  apply(ctx) {
    const { endMin, closeMin } = limits(ctx);
    return endMin <= closeMin ? 'ok' : 'never';
  },
  warn(ctx) {
    const { endMin, closeMin } = limits(ctx);
    return `${ctx.stop.poi.name_zh} 會到 ${minToHm(endMin)}，超過今天收工時間 ${minToHm(closeMin)}`;
  },
};

/** 這一站要比的結束時刻與收工時刻：固定時段的站＝散場時刻（不含散場緩衝）對原時窗；其他站＝結束對扣過留白的收工。 */
function limits(ctx) {
  const fw = ctx.stop.fixedWindow;
  if (!fw) return { endMin: ctx.stop.endMin, closeMin: ctx.day.window.endMin };
  const after = Number.isFinite(fw.endMin) ? (fw.afterMin ?? 0) : 0;
  return { endMin: ctx.stop.endMin - after, closeMin: ctx.day.windowRaw?.endMin ?? ctx.day.window.endMin };
}
