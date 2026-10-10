// 軟約束：夏季正午在都市走動（profile §6 原話：「大中午走在松島的鄉間小路我覺得很棒…東京大阪那種都市我就不願意了」）。
// 夏季月份讀國家層（country.climate.summerMonths），只罰 urban 區、係數 ≥0.5 的站，看停留與 11:30–14:30 的重疊。
import { overlapMin, hmToMin } from '../engine/time.js';

export default {
  id: 'noon-urban',
  kind: 'soft',
  reads: ['stop.poi.walkFactor', 'stop.poi.zoneId', 'stop.startMin', 'stop.endMin', 'day.date', 'country.climate.summerMonths', 'kb.zones'],
  defaults: { from: '11:30', to: '14:30', penaltyMin: 20 },
  apply(ctx) {
    const month = Number(String(ctx.day.date).split('-')[1]);
    if (!ctx.country.climate.summerMonths.includes(month)) return 0;
    if ((ctx.stop.poi.walkFactor ?? 0) < 0.5) return 0;
    const zone = ctx.kb.zones[ctx.stop.poi.zoneId];
    if (!zone || zone.environment !== 'urban') return 0;
    const ov = overlapMin(ctx.stop.startMin, ctx.stop.endMin, hmToMin(ctx.params.from), hmToMin(ctx.params.to));
    return ov > 0 ? ctx.params.penaltyMin : 0;
  },
  warn(ctx) {
    return `${ctx.stop.poi.name_zh} 排在夏天中午的市區，會曬`;
  },
};
