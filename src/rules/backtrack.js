// 軟約束：無謂步行（總則 5：順路是第一義務；折返、穿越當天要去的站）。
// 幾何由 geo 層算進 leg.backtrackMin（T5）；沒有座標就缺欄位、跳過。每分鐘折返罰 perMin 分鐘（預設 2，§5.2 最重的一項）。
export default {
  id: 'backtrack',
  kind: 'soft',
  reads: ['leg.backtrackMin'],
  defaults: { perMin: 2 },
  apply(ctx) {
    return Math.max(0, ctx.leg.backtrackMin) * ctx.params.perMin;
  },
  warn(ctx) {
    return `到 ${ctx.stop.poi.name_zh} 這段走回頭路 ${Math.round(ctx.leg.backtrackMin)} 分`;
  },
};
