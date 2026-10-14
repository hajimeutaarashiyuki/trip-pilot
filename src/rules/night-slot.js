// 軟約束（整天）：每晚都排一個夜間站，缺席不擋（profile §2 原話 #18「7 天 6 夜的話理論上每晚都要安排，反正都是當天最後的行程了，如果我累了就不會去了」）。
// 夜間時窗讀 country.nightSlot（20:00–24:00），不讀 day.window：留白從當日時窗尾端扣掉後（trip.js dayWindow，收工 24:00 → 22:30）
// 夜間站的時段判定不跟著縮，站排不排得進收工前由硬規則 window 管。
// 「每晚都要」是通則：normal 日與 fixed 日（研討會那種整天被釘住的日子，晚上照排）都看；只有飛機日（arrival／departure）與城際移動日（transfer）不管
// （那幾天的晚上是飛機或車，推導；10-14 T23 之前只看 normal 日）。早起日前一晚的取消由 day.nightSlotOff 處理。
// 跨進夜間時窗的固定時段本身也算夜間站（演唱會 19:00–22:00、20:00 的花火：那晚就是那件事，不再要一家 bar；看固定時段的起訖、不含散場緩衝；
// 研討會 09:30–19:30 沒跨進去，晚上照要夜間站——他勾了 賓，累了就不去，#18）。推導；10-14 T23 審查後加。
// 引擎插的恢復站（stop.insertedBy）不算夜間站：跟 meal-slots 一樣，不讓引擎為了補夜間站自己挑 bar。降速策略釘的「現在就去坐」（fixedWindow.pinned）不是固定時段。
import { hmToMin, overlapMin } from '../engine/time.js';

const NIGHT = new Set(['bar', 'food']);
/** 晚上不排夜間站的日型：飛機日與城際移動日（推導） */
const NO_NIGHT_TYPES = new Set(['arrival', 'departure', 'transfer']);

export default {
  id: 'night-slot',
  kind: 'soft',
  scope: 'day',
  reads: ['sequence', 'country.nightSlot', 'day.type'],
  defaults: { missMin: 10 },
  apply(ctx) {
    if (NO_NIGHT_TYPES.has(ctx.day.type) || ctx.day.nightSlotOff) return 0;
    const [from, to] = ctx.country.nightSlot.map(hmToMin);
    const hit = ctx.sequence.some((s) => !s.insertedBy && (
      (NIGHT.has(s.poi.category) && overlapMin(s.startMin, s.endMin, from, to) > 0) || eventIntoNight(s, from, to)
    ));
    return hit ? 0 : ctx.params.missMin;
  },
  warn() {
    return '今晚沒排夜間站';
  },
};

/** 這一站的固定時段（開始到散場，沒寫散場就到站的結束）有沒有跨進夜間時窗。 */
function eventIntoNight(s, from, to) {
  const fw = s.fixedWindow;
  if (!fw || fw.pinned) return false;
  return overlapMin(fw.startMin, Number.isFinite(fw.endMin) ? fw.endMin : s.endMin, from, to) > 0;
}
