// 軟約束：腳的負荷超過當日預算的分鐘數（profile §2.4；總則 0：超預算是警告不是牆）。
// 預算＝walkBudgetMin × 倍率，早起日、女友同行、一日遊翌日同時中取最嚴（#128）。
import { budgetMultiplier } from './_helpers.js';

export default {
  id: 'walk-budget',
  kind: 'soft',
  reads: ['acc.dim-walk'],
  defaults: { perMinOver: 1 },
  apply(ctx) {
    const budget = (ctx.settings.walkBudgetMin ?? 150) * budgetMultiplier(ctx.day, ctx.settings);
    const over = ctx.acc['dim-walk'] - budget;
    return over > 0 ? over * ctx.params.perMinOver : 0;
  },
  warn(ctx) {
    const budget = Math.round((ctx.settings.walkBudgetMin ?? 150) * budgetMultiplier(ctx.day, ctx.settings));
    return `今天走路會到 ${Math.round(ctx.acc['dim-walk'])} 分，超過上限 ${budget}`;
  },
};
