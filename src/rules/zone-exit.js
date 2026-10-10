// 軟約束：離開當日區域（據點圈 ∪ 錨點圈 ∪ 走廊）再回來（profile §2.3、DESIGN §5.2 離圈 +60）。
// 站的 zone 不在 day.regionZones 裡就罰 exitMin 分鐘；regionZones 沒算出來（缺座標）就缺欄位、跳過。
export default {
  id: 'zone-exit',
  kind: 'soft',
  reads: ['stop.poi.zoneId', 'day.regionZones'],
  defaults: { exitMin: 60 },
  apply(ctx) {
    return ctx.day.regionZones.includes(ctx.stop.poi.zoneId) ? 0 : ctx.params.exitMin;
  },
  warn(ctx) {
    return `${ctx.stop.poi.name_zh} 在今天的區域外，去了要再繞回來`;
  },
};
