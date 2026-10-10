// 硬約束（整天）：當天的主行程必排（profile §2.3 錨點；排程層級 ②）。沒排進去＝這一天不成立。
// 主行程排幾點不罰：用意是決定前後行程的區域與路線（原話 #158「有去到最重要 而且主形成的用意是決定前後行程的區域和路線」）。
export default {
  id: 'anchor',
  kind: 'hard',
  scope: 'day',
  reads: ['sequence'],
  defaults: {},
  apply(ctx) {
    const id = ctx.day?.anchorPoiId;
    if (!id) return 'ok';
    return ctx.sequence.some((s) => s.poi.id === id) ? 'ok' : 'no';
  },
  warn(ctx) {
    return `今天的主行程沒排進去（${ctx.day?.anchorName ?? ctx.day?.anchorPoiId}）`;
  },
};
