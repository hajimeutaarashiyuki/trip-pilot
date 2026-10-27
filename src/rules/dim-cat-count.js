// 累積量：當天各店型的家數（給同類店上限、餐段等規則用）。
// 順路站也算進同類的家數：引擎插的順路站（priority 'onway'）跟他勾的站一樣受 ≤N 管（same-type-day）、也數進去（他 10-24 更正，原話 #185「順路站也會被算進同類站裡面 理論上順路這件事 應該只是一個排行程順序的邏輯方式」；10-24 中午 2e36cbd 的放行作廢）。
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
