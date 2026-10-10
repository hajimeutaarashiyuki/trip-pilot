// 累積量：當天各店型的家數（給同類店上限、餐段等規則用）。
export default {
  id: 'dim-cat-count',
  kind: 'dimension',
  reads: ['stop.poi.category'],
  defaults: { initial: {} },
  apply(ctx) {
    const cur = ctx.acc['dim-cat-count'];
    const cat = ctx.stop.poi.category;
    return { ...cur, [cat]: (cur[cat] ?? 0) + 1 };
  },
};
