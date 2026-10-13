// 軟約束（整天）：午餐、晚餐時窗內各要有一個吃的站（DESIGN §11.1 R2-Q1：缺席只警告）。時窗讀國家層 country.mealSlots。
// 引擎插的恢復站（stop.insertedBy）不算餐：Q4「缺席只警告、不替你挑店」，不然引擎會為了補餐段自己從知識庫塞一家餐廳進來。
// 只看落在當天原時窗（day.windowRaw）內的餐段：抵達日 17:00 才開始不罰午餐、離境日 13:00 收工不罰晚餐（10-13 七天實驗；推導）。
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
  const win = ctx.day?.windowRaw ?? ctx.day?.window ?? null;
  for (const [slot, [from, to]] of Object.entries(ctx.country.mealSlots)) {
    const a = hmToMin(from); const b = hmToMin(to);
    if (win && overlapMin(win.startMin, win.endMin, a, b) <= 0) continue;
    const hit = ctx.sequence.some((s) => !s.insertedBy && s.poi.recovery && EATING.has(s.poi.category) && overlapMin(s.startMin, s.endMin, a, b) > 0);
    if (!hit) out.push(slot);
  }
  return out;
}
