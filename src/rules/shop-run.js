// 軟約束：逛店連跑超過上限（4 家或 240 分，#103、#112）；多一家算 shopOverMin 分鐘。
export default {
  id: 'shop-run',
  kind: 'soft',
  reads: ['acc.dim-shop-run'],
  defaults: { shopOverMin: 60, perMinOver: 1 },
  apply(ctx) {
    const { count, min } = ctx.acc['dim-shop-run'];
    const overCount = Math.max(0, count - (ctx.settings.maxShopRunCount ?? 4));
    const overMin = Math.max(0, min - (ctx.settings.maxShopRunMin ?? 240));
    return overCount * ctx.params.shopOverMin + overMin * ctx.params.perMinOver;
  },
  warn(ctx) {
    const { count, min } = ctx.acc['dim-shop-run'];
    return `連著逛了 ${count} 家店、${min} 分，中間沒吃點東西`;
  },
};
