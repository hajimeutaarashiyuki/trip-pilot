// 軟約束：搭車本身也有成本（推導自總則 5 不折返與原話 #163「一日遊會舟車勞頓」）。
// 走路成本（walk-cost）只罰走路，搭車段對引擎是免費的：10-13 七天實驗 8/14 引擎一天來回仙台↔鹽竈兩趟、8/16 仙台↔松島三趟，
// 因為兩頭各有站、車程不花分數。每搭車一分鐘罰 perMin（預設 0.25，跟走路同值：時間都是時間）；quiet 不出警告，拆解（explain）裡看得到。
// 只拿來在同一組站之間分高下，小到不會為了少搭車丟掉任何站（maybe 的價值 45 ＝ 180 分鐘車程）。
export default {
  id: 'ride-cost',
  kind: 'soft',
  quiet: true,
  reads: ['leg.rideMin'],
  defaults: { perMin: 0.25 },
  apply(ctx) {
    return Math.max(0, ctx.leg.rideMin ?? 0) * ctx.params.perMin;
  },
  warn(ctx) {
    return `到 ${ctx.stop.poi.name_zh} 搭車 ${Math.round(ctx.leg.rideMin ?? 0)} 分`;
  },
};
