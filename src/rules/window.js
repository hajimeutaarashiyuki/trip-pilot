// 硬約束：當天的時窗（出門到收工）。站的結束超過收工時刻＝never（再往後插只會更晚）。
import { minToHm } from '../engine/time.js';

export default {
  id: 'window',
  kind: 'hard',
  reads: ['stop.endMin', 'day.window.endMin'],
  defaults: {},
  apply(ctx) {
    return ctx.stop.endMin <= ctx.day.window.endMin ? 'ok' : 'never';
  },
  warn(ctx) {
    return `${ctx.stop.poi.name_zh} 會到 ${minToHm(ctx.stop.endMin)}，超過今天收工時間 ${minToHm(ctx.day.window.endMin)}`;
  },
};
