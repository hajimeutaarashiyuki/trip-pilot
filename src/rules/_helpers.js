// 規則共用的小工具。規則檔只能 import 這裡與 engine/time.js，不能互相 import。
import { hmToMin } from '../engine/time.js';

/** 會計入「逛店連跑」的店型（站著逛的店；代購型藥妝與伴手禮不算，#117、§2.4 細則）。 */
export const SHOP_CATEGORIES = Object.freeze(['vintage', 'record', 'store', 'bookstore']);

/** 非主題日每天上限的三類（原話 #123、#143）。 */
export const SAME_TYPE_CATEGORIES = Object.freeze(['vintage', 'record', 'cafe']);

/** 這一站算不算「恢復」：有坐下或吃喝、而且待得夠久。 */
export function isRecovery(stop, minMin = 0) {
  return Boolean(stop?.poi?.recovery) && (stop.dwellMin ?? 0) >= minMin;
}

/** 坐著搭車 ≥ 門檻也算恢復（原話 #118）。 */
export function rideRest(leg, minMin) {
  return (leg?.rideMin ?? 0) >= minMin;
}

/** 一站的腳的負荷：(停留−爬坡)×係數＋爬坡×爬坡係數；係數 0 的店是 0。 */
export function stopLoad(stop, climbFactor) {
  const wf = stop?.poi?.walkFactor ?? 0;
  const dwell = stop?.dwellMin ?? 0;
  const climb = Math.min(stop?.poi?.climbMin ?? 0, dwell);
  return (dwell - climb) * wf + climb * climbFactor;
}

/** 一段移動的腳的負荷：步行分鐘，爬坡那幾分鐘再乘 (係數−1) 的加成，不重複算。 */
export function legLoad(leg, climbFactor) {
  const walk = leg?.walkMin ?? 0;
  const climb = Math.min(leg?.climbMin ?? 0, walk);
  return walk + climb * (climbFactor - 1);
}

/** 步行預算的倍率：早起日、女友同行、一日遊翌日同時中取最嚴（原話 #128）。 */
export function budgetMultiplier(day, settings) {
  const m = [1];
  if (day?.earlyDay) m.push(settings.earlyDayWalkFactor ?? 0.7);
  if ((day?.party ?? 1) >= 2) m.push(settings.partyWalkFactor ?? 0.85);
  if (day?.dayTripNext) m.push(settings.dayTripNextWalkFactor ?? 0.85);
  return Math.min(...m);
}

/** 設定裡的 "13:00" 之類轉分鐘；已是數字就原樣。 */
export const toMin = (v) => (v == null ? null : hmToMin(v));
