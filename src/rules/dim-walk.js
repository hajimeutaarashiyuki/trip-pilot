// 累積量：腳的負荷（profile §2.4）。(停留−爬坡)×係數＋爬坡×1.5＋步行移動（移動段的爬坡分鐘再加成一次、不重複）。
import { stopLoad, legLoad } from './_helpers.js';

export default {
  id: 'dim-walk',
  kind: 'dimension',
  reads: ['stop.poi.walkFactor', 'stop.dwellMin', 'leg.walkMin'],
  defaults: { initial: 0 },
  apply(ctx) {
    const cf = ctx.settings.climbFactor ?? 1.5;
    return ctx.acc['dim-walk'] + legLoad(ctx.leg, cf) + stopLoad(ctx.stop, cf);
  },
};
