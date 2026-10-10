// 硬約束：早起日下午（earlyDayAfterHM 之後）最多 1 個非恢復站（profile §2 原話「後面的行程儘量排靜的…多休息一點」；站著逛的店也算）。
import { isRecovery, toMin } from './_helpers.js';

export default {
  id: 'early-day',
  kind: 'hard',
  reads: ['day.earlyDay', 'stop.startMin', 'stop.poi.recovery', 'acc.dim-afternoon'],
  defaults: { maxAfternoonStops: 1 },
  apply(ctx) {
    if (!ctx.day.earlyDay) return 'ok';
    const after = toMin(ctx.settings.earlyDayAfterHM ?? '13:00');
    if (ctx.stop.startMin < after || isRecovery(ctx.stop)) return 'ok';
    return ctx.acc['dim-afternoon'] <= ctx.params.maxAfternoonStops ? 'ok' : 'no';
  },
  warn(ctx) {
    return `今天早起，下午只排一個要走的站，${ctx.stop.poi.name_zh} 排不進`;
  },
};
