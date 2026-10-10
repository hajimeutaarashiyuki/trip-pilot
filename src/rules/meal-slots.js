// 軟約束（整天）：午餐、晚餐時窗內各要有一個吃的站（DESIGN §11.1 R2-Q1：缺席只警告）。時窗讀國家層 country.mealSlots。
import { hmToMin, overlapMin } from '../engine/time.js';

const EATING = new Set(['food', 'bar', 'cafe']);

export default {
  id: 'meal-slots',
  kind: 'soft',
  scope: 'day',
  reads: ['sequence', 'country.mealSlots'],
  defaults: { missMin: 20 },
  apply(ctx) {
    return missing(ctx).length * ctx.params.missMin;
  },
  warn(ctx) {
    const names = { lunch: '午餐', dinner: '晚餐' };
    return `今天沒排${missing(ctx).map((k) => names[k] ?? k).join('、')}`;
  },
};

function missing(ctx) {
  const out = [];
  for (const [slot, [from, to]] of Object.entries(ctx.country.mealSlots)) {
    const a = hmToMin(from); const b = hmToMin(to);
    const hit = ctx.sequence.some((s) => s.poi.recovery && EATING.has(s.poi.category) && overlapMin(s.startMin, s.endMin, a, b) > 0);
    if (!hit) out.push(slot);
  }
  return out;
}
