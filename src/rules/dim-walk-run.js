// 累積量：走路連跑（§2.4 節奏）。連續的「停留×係數（係數>0）＋步行」；
// 恢復站待滿 restResetMin、或坐著搭車 ≥ restResetMin 才歸零；係數 0 的店不計入也不歸零（#116 長椅抵不了走路）。
import { isRecovery, rideRest, stopLoad, legLoad } from './_helpers.js';

export default {
  id: 'dim-walk-run',
  kind: 'dimension',
  reads: ['stop.poi.walkFactor', 'stop.poi.recovery', 'stop.dwellMin', 'leg.walkMin'],
  defaults: { initial: 0 },
  apply(ctx) {
    const reset = ctx.settings.restResetMin ?? 30;
    const cf = ctx.settings.climbFactor ?? 1.5;
    if (rideRest(ctx.leg, reset)) {
      // 搭車到站後，站本身的負荷從零開始累
      return stopLoad(ctx.stop, cf);
    }
    const run = ctx.acc['dim-walk-run'] + legLoad(ctx.leg, cf) + stopLoad(ctx.stop, cf);
    return isRecovery(ctx.stop, reset) ? 0 : run;
  },
};
