// 軟約束：同一區來回兩次（總則 5 原文「同一區來回兩次罰」，profile §1；DESIGN §5.2 離圈往返 +60 的同型）。
// 搭車離開一個區、之後又搭車回到這一區，每次罰 reentryMin（預設 60，跟離圈往返同值）；走路就到的隔壁區不算（一番町↔國分町那種本來就會來回穿）。
// 10-13 七天實驗：沒有這條時引擎 8/14 一天來回仙台↔鹽竈兩趟、8/16 仙台↔松島三趟——搭車便宜、兩頭各有站，它就來回跑。
// 回據點所在的區（day.homeZoneId）不算：反正晚上要回去，花火後搭車回站前喝一杯不是來回（8/16 てん. 被這條擋掉過）。
export default {
  id: 'zone-reentry',
  kind: 'soft',
  reads: ['stop.poi.zoneId', 'leg.rideMin', 'sequence'],
  defaults: { reentryMin: 60 },
  apply(ctx) {
    const z = ctx.stop.poi.zoneId;
    if (!ctx.prev || ctx.prev.poi.zoneId === z || (ctx.leg.rideMin ?? 0) <= 0 || (ctx.day?.homeZoneId && z === ctx.day.homeZoneId)) return 0;
    return ctx.sequence.some((s) => s.poi.zoneId === z) ? ctx.params.reentryMin : 0;
  },
  warn(ctx) {
    const z = ctx.stop.poi.zoneId;
    const name = ctx.kb?.zones?.[z]?.name_zh ?? z;
    return `${ctx.stop.poi.name_zh}：又搭車回${name}，同一區來回兩次`;
  },
};
