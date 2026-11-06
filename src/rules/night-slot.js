// 軟約束（整天）：每晚都排一個夜間站，缺席不擋（profile §2 原話 #18「7 天 6 夜的話理論上每晚都要安排，反正都是當天最後的行程了，如果我累了就不會去了」）。
// 夜間時窗讀 country.nightSlot（日本 20:00–24:00），不讀 day.window：留白從當日時窗尾端扣掉後（trip.js dayWindow，收工 24:00 → 22:30）
// 夜間站的時段判定不跟著縮，站排不排得進收工前由硬規則 window 管。
// 尾端另受夜間步行風險 country.transportProfile.nightWalk.risk 管（原話 #145；T20；data/country.js nightWalkCapMin）：low 照 nightSlot、mid 最晚 23:00、high 22:00
// （預設、推導）；這個鍵選填、缺＝low，所以不進 reads（進了框架會因缺欄位把整條規則跳過）。trip.js dayWindow 的時窗尾端套同一個上限。夜間時段的算法在 rules/_slots.js nightWindowOf（分配器同一個）。
// 「每晚都要」是通則：normal 日與 fixed 日（研討會那種整天被釘住的日子，晚上照排）都看；只有飛機日（arrival／departure）與城際移動日（transfer）不管
// （那幾天的晚上是飛機或車，推導；10-14 T23 之前只看 normal 日）。早起日前一晚的取消由 day.nightSlotOff 處理（在場有人「不排夜間站」也走這條，engine/persons.js；T19）；
// 在場有人「少排」（day.nightSlotLess）那天缺席的罰分減半（推導，10-16 T19）。
// 跨進夜間時窗的固定時段本身也算夜間站（演唱會 19:00–22:00、20:00 的花火：那晚就是那件事，不再要一家 bar；看固定時段的起訖、不含散場緩衝；
// 研討會 09:30–19:30 沒跨進去，晚上照要夜間站——他勾了 賓，累了就不去，#18）。推導；10-14 T23 審查後加。
// 引擎插的恢復站（stop.insertedBy）不算夜間站：跟 meal-slots 一樣，不讓引擎為了補夜間站自己挑 bar。降速策略釘的「現在就去坐」（fixedWindow.pinned）不是固定時段。
// 一日遊（day.dayTrip；原話 #190「一日遊的夜間站 可以是在當地進行 只要趕的上末班車都可以 或是回程不算晚(9:00)也可以排進來」；11-06）：
// 當地的夜間站（在外地、落在夜間時段的 bar／food）跟市區的一樣算有——這條本來就不分區；趕不趕得上末班車由硬規則 last-train 管。
// 沒有夜間站、而且回到市區已經晚於 settings.dayTripNightReturnByHM（21:00；回城時刻＝最後一個外地站結束＋回據點的車程，rules/_slots.js returnToTownMin）時，
// 那晚不要求夜間站、不罰（推導：兩個條件都不成立，沒有排得進的夜間站）。回得早（≤21:00）卻沒排，照罰。沒有外地的站、或 day 上沒有 away 表（舊呼叫端）照平常日算。
import { overlapMin } from '../engine/time.js';
import { nightWindowOf, isNightStop, returnToTownMin, dayTripReturnByMin } from './_slots.js';

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
    const night = nightWindowOf(ctx.country);
    if (!night) return 0;
    const hit = ctx.sequence.some((s) => !s.insertedBy && (isNightStop(s, night) || eventIntoNight(s, night[0], night[1])));
    if (hit) return 0;
    if (ctx.day.dayTrip) {
      const back = returnToTownMin(ctx.sequence, ctx.day.away);
      if (back != null && back > dayTripReturnByMin(ctx.settings)) return 0;
    }
    return ctx.day.nightSlotLess ? ctx.params.missMin / 2 : ctx.params.missMin;
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
