// 軟約束（整天）：午餐、晚餐時窗內各要有一個吃的站（DESIGN §11.1 R2-Q1：缺席只警告）。時窗讀國家層 country.mealSlots。
// 引擎插的恢復站（stop.insertedBy）不算餐：Q4「缺席只警告、不替你挑店」，不然引擎會為了補餐段自己從知識庫塞一家餐廳進來。
// 只看落在當天原時窗（day.windowRaw）內的餐段：抵達日 17:00 才開始不罰午餐、離境日 13:00 收工不罰晚餐（10-13 七天實驗；推導）。
// 餐段被固定時段的站蓋住（stop.fixedWindow：研討會供午餐、晚宴那種）也不算缺——人在會場裡，餐是大會的事，不是引擎沒排（推導；10-14 T23）。
// 「蓋住」＝那一站從餐段開始前就在進行、到餐段過半還沒散（s.startMin ≤ 餐段起點、s.endMin ≥ 餐段中點；站的起訖含卡位提前量與散場緩衝）：
// 研討會 08:50–20:00 蓋住午餐 11:30–13:30 與晚餐 18:00–20:30（晚宴在裡面，08-19 計畫 1 夾具寫「研討會＋晚宴」）；
// 餐段中途才開始的（19:00 開演的演唱會、花火）不算，開演前要先吃；早上就散的（09:00–12:00 的半天會，12:00 早於午餐中點 12:30）也不算。
// 10-14 T23 審查前寫的是「整段蓋住」，晚宴永遠落在晚餐段裡、那條對它不成立，審查後改成這條。
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
  // 降速策略釘的「現在就去坐」（fixedWindow.pinned）不是固定時段，不當大會供餐
  const pinned = ctx.sequence.filter((s) => s.fixedWindow && !s.fixedWindow.pinned);
  for (const [slot, [from, to]] of Object.entries(ctx.country.mealSlots)) {
    const a = hmToMin(from); const b = hmToMin(to);
    if (win && overlapMin(win.startMin, win.endMin, a, b) <= 0) continue;
    if (pinned.some((s) => s.startMin <= a && s.endMin >= (a + b) / 2)) continue;
    // 知識庫標 meal: true 的站（祭典的縁日攤位）也算那一餐（原話 #172 採的做法：縁日攤位算晚餐；10-16）
    const hit = ctx.sequence.some((s) => !s.insertedBy && ((s.poi.recovery && EATING.has(s.poi.category)) || s.poi.meal === true) && overlapMin(s.startMin, s.endMin, a, b) > 0);
    if (!hit) out.push(slot);
  }
  return out;
}
