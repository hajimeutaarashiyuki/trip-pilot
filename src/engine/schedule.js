// 時間展開：把「上一站結束 → 移動 → 等開門 → 停留」鋪成一站的起訖。
// 開門前到就等（等待算進時間軸，規則 hours 看的是等完之後的 startMin）；固定時段的站等到該時刻；
// 當天第一站不早於出門時間；第一站要等開門就改成晚點出門。沒有結構化營業時間就不等（hours 規則會跳過並警告）。
import { openIntervals } from './time.js';

/**
 * placeStop({ prevEndMin, leg, poi, dwellMin, date, fixedWindow, dayStartMin, first }) → { startMin, endMin, waitMin, arriveMin }
 * fixedWindow { startMin, endMin?, arriveEarlyMin?, afterMin? }：開始前 arriveEarlyMin 分到場（卡位提前量）；
 * 有 endMin（研討會、預約那種有散場時刻的）結束＝endMin＋afterMin（散場後的緩衝也掛在窗尾，那段不排站），不看 dwellMin；
 * 沒有 endMin（花火那種只釘開始時刻的）照舊 startMin＋dwellMin（DESIGN §11.1 Q7「固定時段前 40 後 30 不排站」；10-14 T23）。
 */
export function placeStop({ prevEndMin, leg, poi, dwellMin, date, fixedWindow = null, dayStartMin = 0, first = false }) {
  const travel = (leg?.walkMin ?? 0) + (leg?.rideMin ?? 0) + (leg?.waitMin ?? 0);
  let arriveMin = Math.max(prevEndMin + travel, dayStartMin);
  let startMin = arriveMin;
  if (fixedWindow) {
    startMin = Math.max(arriveMin, fixedWindow.startMin - (fixedWindow.arriveEarlyMin ?? 0));
  } else {
    const intervals = openIntervals(poi, date);
    if (intervals && intervals.length) {
      // 找第一個「到了之後還能進去」的區間；都過了就維持原值，交給 hours 規則判 never
      const next = intervals.find(([, close]) => arriveMin < close);
      if (next && arriveMin < next[0]) startMin = next[0];
    }
  }
  // 當天第一站：開門前就會到的話改成晚點出門，不在門口等（等開門只發生在站與站之間）
  if (first && startMin > arriveMin) arriveMin = startMin;
  const endMin = Number.isFinite(fixedWindow?.endMin) ? fixedWindow.endMin + (fixedWindow.afterMin ?? 0) : startMin + dwellMin;
  return { arriveMin, startMin, waitMin: startMin - arriveMin, endMin };
}
