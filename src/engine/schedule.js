// 時間展開：把「上一站結束 → 移動 → 等開門 → 停留」鋪成一站的起訖。
// 開門前到就等（等待算進時間軸，規則 hours 看的是等完之後的 startMin）；固定時段的站等到該時刻；
// 當天第一站不早於出門時間。沒有結構化營業時間就不等（hours 規則會跳過並警告）。
import { openIntervals } from './time.js';

/**
 * placeStop({ prevEndMin, leg, poi, dwellMin, date, fixedWindow, dayStartMin }) → { startMin, endMin, waitMin, arriveMin }
 */
export function placeStop({ prevEndMin, leg, poi, dwellMin, date, fixedWindow = null, dayStartMin = 0 }) {
  const travel = (leg?.walkMin ?? 0) + (leg?.rideMin ?? 0) + (leg?.waitMin ?? 0);
  const arriveMin = Math.max(prevEndMin + travel, dayStartMin);
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
  return { arriveMin, startMin, waitMin: startMin - arriveMin, endMin: startMin + dwellMin };
}
