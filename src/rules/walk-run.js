// 軟約束：走路連跑超過上限的分鐘數（§2.4 節奏：連續走路 150 分要有一個 ≥30 分的恢復）。只罰這一站新增的超出分鐘（同 walk-budget，10-13）。
export default {
  id: 'walk-run',
  kind: 'soft',
  reads: ['acc.dim-walk-run'],
  defaults: { perMinOver: 1 },
  apply(ctx) {
    const max = ctx.settings.maxWalkRunMin ?? 150;
    const over = Math.max(0, ctx.acc['dim-walk-run'] - max) - Math.max(0, (ctx.accBefore?.['dim-walk-run'] ?? 0) - max);
    return over > 0 ? over * ctx.params.perMinOver : 0;
  },
  warn(ctx) {
    return `連續走路已經 ${Math.round(ctx.acc['dim-walk-run'])} 分，超過 ${ctx.settings.maxWalkRunMin ?? 150}，該坐一下`;
  },
};
