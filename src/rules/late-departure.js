// 軟約束：太晚出門（profile §2「預設出門時間 09:00–10:00」，原話 #17）。
// 只看當天第一站：出門時刻（到第一站的時刻減移動）比時窗起點晚超過 freeMin（預設 60：09:00 時窗、10:00 前出門都不罰）的部分每分鐘罰 perMin、封頂 capMin。
// 飛機日（抵達、離境）也算：他答「不算」晚出門日（原話 #162），抵達日的時窗起點已含落地緩衝；固定時段的站當第一站（花火那種）不算——那天本來就只有它。
// 第一站開門前到會被 schedule.js 改成晚點出門；沒這條的話引擎會為了省等開門的罰分把整天往後推（試走包 8/13 推到 11:30 出門、早上空著、罰 0，2026-10-12 對抗審查）。
// 晚出門日的時窗起點本來就是 11:00（trip.js dayWindow），不用另外處理；現場改案是從當下接著排（strategies/index.js 標 day.resumed），不算出門。
// prev 是 null、sequence 空＝第一站，都是正常狀態，不列進 reads。
import { minToHm } from '../engine/time.js';

export default {
  id: 'late-departure',
  kind: 'soft',
  reads: [],
  defaults: { freeMin: 60, perMin: 1, capMin: 60 },
  apply(ctx) {
    if (ctx.prev || (ctx.sequence?.length ?? 0) > 0 || ctx.day.resumed) return 0;
    if (ctx.stop.fixedWindow) return 0;
    const over = departMin(ctx) - ctx.day.window.startMin - ctx.params.freeMin;
    return over > 0 ? Math.min(ctx.params.capMin, over * ctx.params.perMin) : 0;
  },
  warn(ctx) {
    const depart = departMin(ctx);
    return `今天 ${minToHm(depart)} 才出門，比預設晚 ${Math.round(depart - ctx.day.window.startMin)} 分`;
  },
};

/** 出門時刻＝到第一站的時刻減移動（第一站等開門已在 schedule.js 改成晚出門，arriveMin 就是 startMin）。 */
function departMin(ctx) {
  const leg = ctx.leg ?? {};
  const travel = (leg.walkMin ?? 0) + (leg.rideMin ?? 0) + (leg.waitMin ?? 0);
  return (ctx.stop.arriveMin ?? ctx.stop.startMin) - travel;
}
