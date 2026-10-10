// 累積量：逛店連跑（翻找疲勞，§2.4）。站著逛的店連著逛：家數與分鐘；收藏量大的店（deepDig）算 2 家；
// ≥ microRestMin 的恢復（吃喝、坐下、坐著搭車）才歸零；其他站（走動類、代購型）不計也不歸零。
import { SHOP_CATEGORIES, isRecovery, rideRest } from './_helpers.js';

export default {
  id: 'dim-shop-run',
  kind: 'dimension',
  reads: ['stop.poi.category', 'stop.poi.recovery', 'stop.dwellMin'],
  defaults: { initial: { count: 0, min: 0 } },
  apply(ctx) {
    const micro = ctx.settings.microRestMin ?? 10;
    const cur = ctx.acc['dim-shop-run'];
    if (isRecovery(ctx.stop, micro) || rideRest(ctx.leg, micro)) return { count: 0, min: 0 };
    const poi = ctx.stop.poi;
    if (!SHOP_CATEGORIES.includes(poi.category) || poi.walkFactor > 0) return cur;
    const units = poi.deepDig ? (ctx.settings.deepDigCount ?? 2) : 1;
    return { count: cur.count + units, min: cur.min + (ctx.stop.dwellMin ?? 0) };
  },
};
