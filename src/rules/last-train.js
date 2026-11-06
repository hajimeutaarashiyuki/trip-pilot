// 硬約束：末班車（原話 #190「一日遊的夜間站 可以是在當地進行 只要趕的上末班車都可以」；11-06）。
// 末班資料寫在知識庫 zones.json 的跨區連結上："last": { "<出發區 id>": "HH:MM" }（從那一區往另一端的末班發車時刻）。geo/matrix.js 把它讀進區對區的搭車連結，
// engine/trip.js 每天整理成兩張表掛在 day 上（lastLegsOf、awayOf），這條規則只查表：
// (1) 這一段搭車趕不上：從上一站（第一站＝住宿）到這一站要搭車（leg.rideMin > 0）、那條路有末班資料（day.lastLegs["<起區>|<訖區>"]），
//     而離開上一站的時刻晚於「最晚要離開的時刻」（leaveByMin＝末班發車 − 走去搭車的分鐘；轉乘一次的兩段各算，取先卡住的那一班，geo/matrix.js）。
// (2) 待到太晚回不了住宿：這一站在外地（day.away：從那一區回住宿要搭車）、回程那條路有末班資料，而這一站的結束晚於最晚要離開的時刻。
//     引擎不排「回住宿」那一段，沒有這一項的話當地的夜間站可以排到末班車開走之後。不只一日遊，哪一天去外地都判。
// 兩種都回 never（再往後插只會更晚，跟 window 同理）。沒有末班資料的連結不判（知識庫沒查到的不擋）；day 上沒有這兩張表（舊呼叫端、自訂的 legFn）也不判。
// 他勾的站一樣擋：趕不上末班車是排不進，不是偏好（跟營業時間、收工時刻同一種硬時限）。
// 現場改案（day.resumed）的第一段不判 (1)：那一段的起點是他現在的位置、不是住宿，規則看不到是哪一區；(2) 照判。
// 兩張表選填、沒有是常態，不列進 reads（列了框架會因缺欄位把整條規則跳過並警告），apply 自己判。
import { minToHm } from '../engine/time.js';

export default {
  id: 'last-train',
  kind: 'hard',
  reads: [],
  defaults: {},
  apply(ctx) {
    if (!ctx.day || (!ctx.day.lastLegs && !ctx.day.away)) return 'ok';
    return missed(ctx) ? 'never' : 'ok';
  },
  warn(ctx) {
    const name = ctx.stop.poi.name_zh;
    const m = missed(ctx);
    if (!m) return `${name} 趕不上末班車`;
    const from = ctx.kb?.zones?.[m.last.fromZoneId]?.name_zh;
    const tail = `趕不上 ${minToHm(m.last.departMin)} 的末班車${from ? `，${from}發車` : ''}`;
    return m.kind === 'leg' ? `去 ${name} ${tail}` : `${name} 待到 ${minToHm(ctx.stop.endMin)}，回住宿${tail}`;
  },
};

/** 這一站卡在哪一班末班車：{ kind: 'leg'（去程這段）｜'home'（回住宿）, last: { leaveByMin, departMin, fromZoneId } }；都趕得上回 null。 */
function missed(ctx) {
  const { day, stop, leg, prev } = ctx;
  const zone = stop.poi?.zoneId;
  if (!zone) return null;
  if (day.lastLegs && (leg?.rideMin ?? 0) > 0) {
    const from = prev ? prev.poi?.zoneId : (day.resumed ? null : day.homeZoneId);
    const last = from ? day.lastLegs[`${from}|${zone}`] : null;
    if (last) {
      const leaveMin = (stop.arriveMin ?? stop.startMin) - ((leg.walkMin ?? 0) + (leg.rideMin ?? 0) + (leg.waitMin ?? 0));
      if (leaveMin > last.leaveByMin) return { kind: 'leg', last };
    }
  }
  const home = day.away?.[zone]?.last;
  if (home && stop.endMin > home.leaveByMin) return { kind: 'home', last: home };
  return null;
}
