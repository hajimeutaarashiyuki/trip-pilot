// 軟約束：咖啡廳類連排（原話 #113「不連排就好」）。前一站與這一站都是坐著喝咖啡的店就罰 sameTypeMin 分鐘。
// 夜間續攤 bar→bar、晚餐→夜間站不在這條（#127）；它們本來就不是咖啡廳類。
export default {
  id: 'cafe-adjacent',
  kind: 'soft',
  reads: ['stop.poi.cafeLike'],
  defaults: { sameTypeMin: 40 },
  apply(ctx) {
    const prev = ctx.prev;
    if (!prev || !prev.poi?.cafeLike || !ctx.stop.poi.cafeLike) return 0;
    return ctx.params.sameTypeMin;
  },
  warn(ctx) {
    return `${ctx.prev?.poi?.name_zh ?? '上一站'}接著${ctx.stop.poi.name_zh}，兩家咖啡廳連著`;
  },
};
