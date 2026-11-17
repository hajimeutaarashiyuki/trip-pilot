// 硬約束：末班車（原話 #190「一日遊的夜間站 可以是在當地進行 只要趕的上末班車都可以」；11-06）。只擋引擎自己插的站；他勾的站不擋。
// 末班資料寫在知識庫 zones.json 的跨區連結上："last": { "<出發區 id>": "HH:MM" 或 { weekday, saturday, holiday } }（從那一區往另一端的末班發車時刻；分日別見 geo/matrix.js）。
// geo/matrix.js 把它讀進區對區的搭車連結，engine/trip.js 每天照那天的日別整理成兩張表掛在 day 上（lastLegsOf、awayOf），這條規則只查表，判法在 rules/_slots.js missedLastTrain：
// (1) 這一段搭車趕不上：從上一站（第一站＝住宿）到這一站要搭車（leg.rideMin > 0）、那條路有末班資料（day.lastLegs["<起區>|<訖區>"]），
//     而離開上一站的時刻晚於「最晚要離開的時刻」（leaveByMin＝末班發車 − 走去搭車的分鐘；轉乘一次的兩段各算，取先卡住的那一班，geo/matrix.js）。
// (2) 待到太晚回不了住宿：這一站在外地（day.away：從那一區回住宿要搭車）、回程那條路有末班資料，而這一站的結束晚於最晚要離開的時刻。
//     引擎不排「回住宿」那一段，沒有這一項的話當地的站可以排到末班車開走之後。不只一日遊，哪一天去外地都判。
// 兩種都回 never（再往後插只會更晚，跟 window 同理）。沒有末班資料的連結不判（知識庫沒查到的不擋）；day 上沒有這兩張表（舊呼叫端、自訂的 legFn）也不判。
// 誰擋、誰不擋（11-06 第二批改；上一版連他勾的站都擋）：
// - 引擎自己插的站（stop.insertedBy：恢復站、填站、順路站、坐下來的地方、現場「累了」找的那家）趕不上就不插。
// - 他勾的站（picks，含主行程、指定站；分配器分進旅程檔的也是 picks）不擋：總則 0「一定都要保持彈性，不能說一個地方沒去到我所有行程都卡死」、總則 3 點名就排——
//   都凌駕 DESIGN §1.7 把末班車列成單站不可行的推導；而且知識庫的末班是查來的一個時刻（星期對不上、改點、特殊期間取最早的保守值），當牆會把他勾的站丟錯
//   （審查實測：8/15 週六的秋保被日祝的 19:18 丟掉，那天其實還有 21:01）。照排之後那一站掛一條提示（rules/_slots.js lastTrainHints；engine/trip.js planTrip 排完掛、不罰）。
// - day.lastTrainWall（engine/trip.js 試排用，平常沒有）：{ except: [poiId…] }——有這個鍵時他勾的站也當牆，except 裡的那幾站除外。
//   不擋不代表不管：planTrip 排出來有他勾的站趕不上時，拿它再排，找「每一站都留著、趕得上的都趕上」的順序（先去外地那一站再回市區、外地的站挪到早上這種）；
//   怎麼排都趕不上的那幾站進 except、照排掛提示。他勾的站不會因為末班車少掉，只會因為它換順序（做法與試作結果寫在 engine/trip.js planTrip）。
// 現場改案（day.resumed）的第一段不判 (1)：那一段的起點是他現在的位置、不是住宿，規則看不到是哪一區；(2) 照判。
// 兩張表選填、沒有是常態，不列進 reads（列了框架會因缺欄位把整條規則跳過並警告），apply 自己判。
import { missedLastTrain, lastTrainText } from './_slots.js';

/** 這一站拿不拿末班車擋：引擎插的一律擋；他勾的平常不擋，試排時（day.lastTrainWall）除了 except 裡的都擋。 */
function walled(ctx) {
  if (ctx.stop?.insertedBy) return true;
  const wall = ctx.day.lastTrainWall;
  return Boolean(wall) && !(Array.isArray(wall.except) && wall.except.includes(ctx.stop?.poi?.id));
}

export default {
  id: 'last-train',
  kind: 'hard',
  reads: [],
  defaults: {},
  apply(ctx) {
    const day = ctx.day;
    if (!day || (!day.lastLegs && !day.away)) return 'ok';
    if (!walled(ctx)) return 'ok';
    return missedLastTrain(ctx) ? 'never' : 'ok';
  },
  warn(ctx) {
    return lastTrainText(ctx.stop, missedLastTrain(ctx), ctx.kb);
  },
};
