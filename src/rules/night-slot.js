// 軟約束（整天）：每晚都排一個夜間站，缺席不擋（profile §2 原話「理論上每晚都要安排…如果我累了就不會去了」）。
// 夜間時窗讀 country.nightSlot（20:00–24:00），不讀 day.window：留白從當日時窗尾端扣掉後（trip.js dayWindow，收工 24:00 → 22:30）
// 夜間站的時段判定不跟著縮，站排不排得進收工前由硬規則 window 管。只看 normal 日；早起日前一晚的取消由 day.nightSlotOff 處理。
// 引擎插的恢復站（stop.insertedBy）不算夜間站：跟 meal-slots 一樣，不讓引擎為了補夜間站自己挑 bar。
import { hmToMin, overlapMin } from '../engine/time.js';

const NIGHT = new Set(['bar', 'food']);

export default {
  id: 'night-slot',
  kind: 'soft',
  scope: 'day',
  reads: ['sequence', 'country.nightSlot', 'day.type'],
  defaults: { missMin: 10 },
  apply(ctx) {
    if (ctx.day.type !== 'normal' || ctx.day.nightSlotOff) return 0;
    const [from, to] = ctx.country.nightSlot.map(hmToMin);
    const hit = ctx.sequence.some((s) => !s.insertedBy && NIGHT.has(s.poi.category) && overlapMin(s.startMin, s.endMin, from, to) > 0);
    return hit ? 0 : ctx.params.missMin;
  },
  warn() {
    return '今晚沒排夜間站';
  },
};
