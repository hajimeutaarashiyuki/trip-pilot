// 硬約束：一天最多幾站（預設 8；他只說九站太滿，DESIGN §9）。超過＝never。
export default {
  id: 'max-stops',
  kind: 'hard',
  reads: ['sequence'],
  defaults: {},
  apply(ctx) {
    const max = ctx.settings.maxStopsPerDay ?? 8;
    return ctx.sequence.length + 1 <= max ? 'ok' : 'never';
  },
  warn(ctx) {
    return `今天已經 ${ctx.sequence.length} 站，上限 ${ctx.settings.maxStopsPerDay ?? 8}`;
  },
};
