// 軟約束：腳的負荷超過當日預算的分鐘數（profile §2.4；總則 0：超預算是警告不是牆）。
// 預算＝walkBudgetMin × 倍率，早起日、女友同行、一日遊翌日同時中取最嚴（#128）。
// 只罰這一站新增的超出分鐘（acc 減 accBefore）：原本每站都罰整個超出量，超過之後每多一站就把同一筆超出再罰一次
// （10-13 七天實驗 8/16：花火那站罰 71、後面的立飲再罰 76，引擎因此把晚上的站全砍掉）。
import { budgetMultiplier } from './_helpers.js';

export default {
  id: 'walk-budget',
  kind: 'soft',
  reads: ['acc.dim-walk'],
  defaults: { perMinOver: 1 },
  apply(ctx) {
    const budget = (ctx.settings.walkBudgetMin ?? 150) * budgetMultiplier(ctx.day, ctx.settings);
    const over = Math.max(0, ctx.acc['dim-walk'] - budget) - Math.max(0, (ctx.accBefore?.['dim-walk'] ?? 0) - budget);
    return over > 0 ? over * ctx.params.perMinOver : 0;
  },
  warn(ctx) {
    const budget = Math.round((ctx.settings.walkBudgetMin ?? 150) * budgetMultiplier(ctx.day, ctx.settings));
    return `今天走路會到 ${Math.round(ctx.acc['dim-walk'])} 分，超過上限 ${budget}`;
  },
};
