// 硬約束：固定時段（花火、開演、已預約、有期限的待辦、研討會；profile §2.2 ①）。
// 有 fixedWindow 的站：到得太晚＝never（錯過了），排程會自己等到開始時刻，所以到得早不算錯。
// fixedWindow { startMin, endMin?, arriveEarlyMin?, afterMin? }：這條只看開始；結束（endMin＋afterMin）由排程 schedule.js 釘、再由硬規則 window 看收工（固定時段的站對原時窗比），
// 預設提前量與散場緩衝（settings.fixedBeforeMin 40／fixedAfterMin 30）在 trip.js planTrip 補進 fixedWindow（10-14 T23）。
// 現場改案（day.resumed：從當下接著排）時，釘起訖的站只要還沒散（排到的開始時刻早於 endMin）就 ok：人已經在會場裡、或遲到了還趕得上後半——
// 不然研討會中途按「累了」每一案都把會場丟掉、叫他去 bar（10-14 T23 審查）。出門前的排程照舊：不排一個會遲到的固定時段。只釘開始的（花火）遲到還是錯過。
import { minToHm } from '../engine/time.js';

export default {
  id: 'fixed-window',
  kind: 'hard',
  reads: ['stop.startMin'],
  defaults: {},
  apply(ctx) {
    const w = ctx.stop.fixedWindow;
    if (!w) return 'ok';
    const arriveBy = w.startMin - (w.arriveEarlyMin ?? 0);
    if (ctx.stop.startMin <= arriveBy) return 'ok';
    if (ctx.day.resumed && Number.isFinite(w.endMin) && ctx.stop.startMin < w.endMin) return 'ok';
    return 'never';
  },
  warn(ctx) {
    const w = ctx.stop.fixedWindow;
    if (!w) return '';
    if (ctx.day.resumed && Number.isFinite(w.endMin)) return `${ctx.stop.poi.name_zh} ${minToHm(w.endMin)} 就散了，現在排到 ${minToHm(ctx.stop.startMin)} 才到`;
    return `${ctx.stop.poi.name_zh} 要在 ${minToHm(w.startMin - (w.arriveEarlyMin ?? 0))} 前到，現在排到 ${minToHm(ctx.stop.startMin)}`;
  },
};
