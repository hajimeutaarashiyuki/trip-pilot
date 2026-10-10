// 累積量：早起日下午（earlyDayAfterHM 之後開始）的非恢復站家數（含站著逛的店，原話「排靜的…多休息一點」）。
import { isRecovery, toMin } from './_helpers.js';

export default {
  id: 'dim-afternoon',
  kind: 'dimension',
  reads: ['stop.startMin', 'stop.poi.recovery'],
  defaults: { initial: 0 },
  apply(ctx) {
    const after = toMin(ctx.settings.earlyDayAfterHM ?? '13:00');
    const cur = ctx.acc['dim-afternoon'];
    if (ctx.stop.startMin < after || isRecovery(ctx.stop)) return cur;
    return cur + 1;
  },
};
