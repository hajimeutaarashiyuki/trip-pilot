// 累積量：當天各店型的家數（給同類店上限、餐段等規則用）。
// 引擎插的順路站（priority 'onway'）不數：順路站直接排、先於非主題日同類 ≤N（原話 #170 先於 #123，他 10-24 定），數了會把他勾的第 2 家擋掉。
export default {
  id: 'dim-cat-count',
  kind: 'dimension',
  reads: ['stop.poi.category'],
  defaults: { initial: {} },
  apply(ctx) {
    const cur = ctx.acc['dim-cat-count'];
    if (ctx.stop.priority === 'onway') return cur;
    const cat = ctx.stop.poi.category;
    return { ...cur, [cat]: (cur[cat] ?? 0) + 1 };
  },
};
