// 硬約束：營業時間。到達要在某個營業區間內、而且待到離開不超過該區間的關門時刻。
// 當天根本沒開（休息日、closedDates）→ never（今天再往後插也不可能）。
// hours 是 null（研究查不到）→ reads 缺欄位，引擎跳過並警告（§5.12：這種站要附備案）。
// 固定時段的站（stop.fixedWindow：花火、研討會、已預約）不看營業時間：到場與離場由固定時段釘（schedule.js），卡位提前量與散場緩衝本來就落在營業時間外——
// 不然會場寫 09:30–19:30、08:50 到場卡位就被判「還沒開」而排不進（推導；10-14 T23）。固定時段本身的硬約束在 fixed-window。
import { openIntervals, minToHm } from '../engine/time.js';

export default {
  id: 'hours',
  kind: 'hard',
  reads: ['stop.poi.hours', 'stop.startMin', 'stop.endMin', 'day.date'],
  defaults: { lastEntryMin: 0 },
  apply(ctx) {
    if (ctx.stop.fixedWindow) return 'ok';
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
