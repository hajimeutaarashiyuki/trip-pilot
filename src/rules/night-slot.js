// 軟約束（整天）：每晚都排一個夜間站，缺席不擋（profile §2 原話「理論上每晚都要安排…如果我累了就不會去了」）。
// 夜間時窗讀 country.nightSlot；只看 normal 日；早起日前一晚的取消由 day.nightSlotOff 處理。
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
    const hit = ctx.sequence.some((s) => NIGHT.has(s.poi.category) && overlapMin(s.startMin, s.endMin, from, to) > 0);
    return hit ? 0 : ctx.params.missMin;
  },
  warn() {
    return '今晚沒排夜間站';
  },
};
