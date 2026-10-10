// 硬約束：營業時間。到達要在某個營業區間內、而且待到離開不超過該區間的關門時刻。
// 當天根本沒開（休息日、closedDates）→ never（今天再往後插也不可能）。
// hours 是 null（研究查不到）→ reads 缺欄位，引擎跳過並警告（§5.12：這種站要附備案）。
import { openIntervals, minToHm } from '../engine/time.js';

export default {
  id: 'hours',
  kind: 'hard',
  reads: ['stop.poi.hours', 'stop.startMin', 'stop.endMin', 'day.date'],
  defaults: { lastEntryMin: 0 },
  apply(ctx) {
    const intervals = openIntervals(ctx.stop.poi, ctx.day.date);
    if (intervals === null) return 'ok';
    if (intervals.length === 0) return 'never';
    const { startMin, endMin } = ctx.stop;
    const lastEntry = ctx.params.lastEntryMin ?? 0;
    for (const [open, close] of intervals) {
      if (startMin >= open && startMin <= close - lastEntry && endMin <= close) return 'ok';
    }
    // 還沒開：排程會等開門，所以是 no；全部區間都已過：never
    const lastClose = Math.max(...intervals.map(([, c]) => c));
    return startMin >= lastClose ? 'never' : 'no';
  },
  warn(ctx) {
    const intervals = openIntervals(ctx.stop.poi, ctx.day.date) ?? [];
    if (intervals.length === 0) return `${ctx.stop.poi.name_zh} 今天沒開`;
    return `${ctx.stop.poi.name_zh} ${minToHm(ctx.stop.startMin)} 到的時候不在營業時間內（${intervals.map(([o, c]) => `${minToHm(o)}–${minToHm(c)}`).join('、')}）`;
  },
};
