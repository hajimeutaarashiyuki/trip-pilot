// 硬約束（整天）：同一品項的主題日不連續兩天（原話 #65「整天皮衣、整天黑膠」；#137：單一站不算，只有整天主題才算）。
export default {
  id: 'item-gap',
  kind: 'hard',
  scope: 'day',
  reads: ['day.themeCategory'],
  defaults: {},
  apply(ctx) {
    const t = ctx.day.themeCategory;
    if (!t) return 'ok';
    return ctx.day.prevThemeCategory === t ? 'no' : 'ok';
  },
  warn(ctx) {
    return `昨天已經是一整天的${ctx.day.themeCategory}，今天又是，會膩`;
  },
};
