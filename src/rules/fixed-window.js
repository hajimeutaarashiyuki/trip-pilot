// 硬約束：固定時段（花火、開演、已預約、有期限的待辦；profile §2.2 ①）。
// 有 fixedWindow 的站：到得太晚＝never（錯過了），排程會自己等到開始時刻，所以到得早不算錯。
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
    return ctx.stop.startMin <= arriveBy ? 'ok' : 'never';
  },
  warn(ctx) {
    const w = ctx.stop.fixedWindow;
    return w ? `${ctx.stop.poi.name_zh} 要在 ${minToHm(w.startMin - (w.arriveEarlyMin ?? 0))} 前到，現在排到 ${minToHm(ctx.stop.startMin)}` : '';
  },
};
