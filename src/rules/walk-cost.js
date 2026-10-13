// 軟約束：走路本身就有成本（總則 5：「同樣的站，走得少的順序永遠贏」；原話 #168「sega ru跟squat 根本不順路」）。
// 步行預算（walk-budget）只在超過上限才罰，上限內的走路對引擎是免費的，所以同一組站它不會挑走得少的順序
// （試走包 8/17：Utah→星山→SEGA-RU→SQUAT→me 走 42 分，Utah→SQUAT→me→星山→SEGA-RU 只要 26 分，引擎卻排前者）。
// 每走一分鐘罰 perMin（預設 0.25）：只拿來在「同一組站」之間分高下，小到不會為了少走路丟掉任何站（maybe 的價值 45 ＝ 180 分鐘走路）。
// quiet：每段都會有罰分，不出警告（不然每站一行黃字）；拆解（explain）裡看得到。
export default {
  id: 'walk-cost',
  kind: 'soft',
  quiet: true,
  reads: ['leg.walkMin'],
  defaults: { perMin: 0.25 },
  apply(ctx) {
    return Math.max(0, ctx.leg.walkMin ?? 0) * ctx.params.perMin;
  },
  warn(ctx) {
    return `到 ${ctx.stop.poi.name_zh} 走 ${Math.round(ctx.leg.walkMin ?? 0)} 分`;
  },
};
