// 硬約束（整天）：當天的主行程必排（profile §2.3 錨點；排程層級 ②）。沒排進去＝這一天不成立。
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
