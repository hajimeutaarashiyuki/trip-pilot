// 軟約束（整天）：午餐、晚餐各要有一個吃的站（DESIGN §11.1 R2-Q1：缺席只警告）。餐段讀國家層 country.mealSlots。
// 引擎插的恢復站（stop.insertedBy）不算餐：Q4「缺席只警告、不替你挑店」，不然引擎會為了補餐段自己從知識庫塞一家餐廳進來。
// 只看落在當天原時窗（day.windowRaw）內的餐段：抵達日 17:00 才開始不罰午餐、離境日 13:00 收工不罰晚餐（10-13 七天實驗；推導）。
// 餐段被固定時段的站蓋住（stop.fixedWindow：研討會供午餐、晚宴那種）也不算缺——人在會場裡，餐是大會的事，不是引擎沒排（推導；10-14 T23）。
// 「蓋住」＝那一站從餐段開始前就在進行、到餐段過半還沒散（s.startMin ≤ 餐段起點、s.endMin ≥ 餐段中點；站的起訖含卡位提前量與散場緩衝）：
// 研討會 08:50–20:00 蓋住午餐 11:30–13:30 與晚餐 18:00–20:30（晚宴在裡面，08-19 計畫 1 夾具寫「研討會＋晚宴」）；
// 餐段中途才開始的（19:00 開演的演唱會、花火）不算，開演前要先吃；早上就散的（09:00–12:00 的半天會，12:00 早於午餐中點 12:30）也不算。
// 10-14 T23 審查前寫的是「整段蓋住」，晚宴永遠落在晚餐段裡、那條對它不成立，審查後改成這條。
// 餐段放寬（11-06；原話 #189「這點不強制 像是有主行程要跑 但時間落在晚餐時段 那晚餐提早或延後 都可以」）：吃的站落在餐段前後各 settings.mealGraceMin（預設 60）分以內
// 就算那一餐（日本值：午 10:30–14:30、晚 17:00–21:30；午餐比照是推導）。之前要跟餐段本身重疊才算——七天包 8/16 松島流灯会 18:30–20:20 佔住晚餐段，
// 回城後 21:03 才喝的那一杯不算，那天出「今天沒排晚餐」；17:00 一開門就進去吃的晚餐也不算。「這天要不要這一餐」與「被固定時段蓋住」照舊看原本的餐段；放寬的只有「這一站算不算」。
// 每一站最多算一餐（午、晚不重複算；rules/_slots.js unmetMeals）。餐段、放寬量與配站的算法在 rules/_slots.js，分配器（engine/allocate.js）判「這家能當午餐／晚餐」用同一把尺。
import { overlapMin } from '../engine/time.js';
import { mealSlotsOf, inWindow, coversMealSlot, unmetMeals } from './_slots.js';

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

/** 這一站算不算吃的站：坐下來吃喝的店（food／bar／cafe 而且是恢復站）、或知識庫標 meal: true 的站（祭典的縁日攤位，原話 #172；10-16）；引擎插的不算。 */
const eats = (s) => !s.insertedBy && ((s.poi.recovery && EATING.has(s.poi.category)) || s.poi.meal === true);

function missing(ctx) {
  const win = ctx.day?.windowRaw ?? ctx.day?.window ?? null;
  // 降速策略釘的「現在就去坐」（fixedWindow.pinned）不是固定時段，不當大會供餐
  const pinned = ctx.sequence.filter((s) => s.fixedWindow && !s.fixedWindow.pinned);
  const needs = [];
  for (const { slot, core, window } of mealSlotsOf(ctx.country, ctx.settings)) {
    if (win && overlapMin(win.startMin, win.endMin, core[0], core[1]) <= 0) continue;
    if (pinned.some((s) => coversMealSlot(s.startMin, s.endMin, core))) continue;
    needs.push({ slot, cands: ctx.sequence.filter((s) => eats(s) && inWindow(s.startMin, s.endMin, window)) });
  }
  return unmetMeals(needs);
}
