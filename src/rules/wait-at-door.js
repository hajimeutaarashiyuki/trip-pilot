// 軟約束：等開門（原話 #155「當成留白 但也要罰 因為應該也可以在加進一個行程吧」）。
// 到了還沒開、在門口等超過 freeMin 的部分每分鐘罰 perMin 分、封頂 capMin；freeMin 以內當留白不罰。
// 固定時段的站（fixedWindow，例如花火）提早到是卡位、不是等店開門：不罰（#155 講的是店開門前的等待）；
// fixedWindow 平常是 null，不列進 reads（列了會被當缺欄位跳過）。
// 當天第一站要等開門的話 schedule.js 已改成晚點出門（waitMin 0），所以這條只會罰站與站之間的等待；推太晚由 late-departure 罰。
export default {
  id: 'wait-at-door',
  kind: 'soft',
  reads: ['stop.waitMin'],
  defaults: { freeMin: 15, perMin: 1, capMin: 60 },
  apply(ctx) {
    if (ctx.stop.fixedWindow) return 0;
    const over = ctx.stop.waitMin - ctx.params.freeMin;
    return over > 0 ? Math.min(ctx.params.capMin, over * ctx.params.perMin) : 0;
  },
  warn(ctx) {
    return `到 ${ctx.stop.poi.name_zh} 要在門口等 ${Math.round(ctx.stop.waitMin)} 分`;
  },
};
