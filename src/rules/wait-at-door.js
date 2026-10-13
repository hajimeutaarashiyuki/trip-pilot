// 軟約束：等開門（原話 #155「當成留白 但也要罰 因為應該也可以在加進一個行程吧」）。
// 到了還沒開、在門口等超過 freeMin 的部分每分鐘罰 perMin 分、封頂 capMin；freeMin 以內當留白不罰。
// 固定時段的站（fixedWindow，例如花火）：卡位的提前量 arriveEarlyMin 已經在排程裡算進開始時刻（schedule.js），
// waitMin 是比卡位時刻還早到的部分，是空等，一樣罰（10-13 七天實驗：不罰的話引擎讓他 8/16 在松島空等 137 分）；
// fixedWindow 平常是 null，不列進 reads（列了會被當缺欄位跳過）。
// 當天第一站要等開門的話 schedule.js 已改成晚點出門（waitMin 0），所以這條只會罰站與站之間的等待；推太晚由 late-departure 罰。
export default {
  id: 'wait-at-door',
  kind: 'soft',
  reads: ['stop.waitMin'],
  defaults: { freeMin: 15, perMin: 1, capMin: 60 },
  apply(ctx) {
    const over = ctx.stop.waitMin - ctx.params.freeMin;
    return over > 0 ? Math.min(ctx.params.capMin, over * ctx.params.perMin) : 0;
  },
  warn(ctx) {
    if (ctx.stop.fixedWindow) return `到 ${ctx.stop.poi.name_zh} 比卡位時刻還早 ${Math.round(ctx.stop.waitMin)} 分，空等`;
    return `到 ${ctx.stop.poi.name_zh} 要在門口等 ${Math.round(ctx.stop.waitMin)} 分`;
  },
};
