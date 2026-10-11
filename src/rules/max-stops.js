// 硬約束：一天最多幾站（預設 8；他只說九站太滿，DESIGN §9）。超過＝never。
// 只數他勾的站：引擎插的（optional：恢復站、填站）不佔名額，它們另有 settings.restInsertMaxPerDay 管上限
// （推導，2026-10-12 主控拍板：試走包 8/13 價值 0 的填站擠掉他勾的青葉神社）。
export default {
  id: 'max-stops',
  kind: 'hard',
  reads: ['sequence'],
  defaults: {},
  apply(ctx) {
    if (ctx.stop.optional) return 'ok';
    const max = ctx.settings.maxStopsPerDay ?? 8;
    return pickedCount(ctx.sequence) + 1 <= max ? 'ok' : 'never';
  },
  warn(ctx) {
    return `今天已經 ${pickedCount(ctx.sequence)} 站，上限 ${ctx.settings.maxStopsPerDay ?? 8}`;
  },
};

const pickedCount = (sequence) => sequence.filter((s) => !s.optional).length;
