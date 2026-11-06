// 硬約束（整天）：一日遊回到市區已經晚於 settings.dayTripNightReturnByHM（21:00）之後，引擎自己插的站（stop.insertedBy：恢復站、填站）不當市區的夜間站。
// 原話 #190「一日遊的夜間站 可以是在當地進行 只要趕的上末班車都可以 或是回程不算晚(9:00)也可以排進來」——回程不算晚才排進來，反過來就是晚了不主動排（推導；11-06）。
// 他勾的站不擋（總則 3 指定行程凌駕偏好）：照排，只在那一站掛一條提示（rules/_slots.js dayTripNightHints，engine/trip.js planTrip 排完掛，不罰）。
// 回城時刻＝最後一個外地站結束＋回據點的車程（rules/_slots.js returnToTownMin）；市區＝站的區不在 day.away 裡；夜間站＝bar／food 且落在夜間時段。
// 放在整天層級：序列裡有這種站，這一天就不成立（'no'），搜尋會選沒有它的那條——引擎插的站是 optional，拿掉不算落選；每個搜尋節點只問一次，不用每個候選問一次。
// 不管的情況：不是一日遊；現場改案（day.resumed）——按「累了」找地方坐是他要的，不是引擎主動排；降速策略釘的「現在就去坐」（fixedWindow.pinned）同理。
// 當地（外地）的夜間站不歸這條管，趕不趕得上末班車由 last-train 管。day.away 選填，不列進 reads。
import { minToHm } from '../engine/time.js';
import { lateTownNightStops } from './_slots.js';

export default {
  id: 'day-trip-night',
  kind: 'hard',
  scope: 'day',
  reads: ['sequence'],
  defaults: {},
  apply(ctx) {
    if (!ctx.day?.dayTrip || ctx.day.resumed || !ctx.day.away) return 'ok';
    return inserted(ctx).length ? 'no' : 'ok';
  },
  warn(ctx) {
    const hit = inserted(ctx);
    if (!hit.length) return '一日遊回到市區已經晚了，不再多排夜間站';
    return `一日遊回到市區已經 ${minToHm(hit[0].backMin)}（晚於 ${minToHm(hit[0].byMin)}），不再多排夜間站（${hit.map((x) => x.stop.poi.name_zh).join('、')}）`;
  },
};

/** 晚回城之後、引擎自己插的市區夜間站。 */
function inserted(ctx) {
  return lateTownNightStops(ctx).filter((x) => x.stop.insertedBy && !x.stop.fixedWindow?.pinned);
}
