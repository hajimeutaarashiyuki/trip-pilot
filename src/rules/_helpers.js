// 規則共用的小工具。規則檔只能 import 這裡與 engine/time.js，不能互相 import。
import { hmToMin } from '../engine/time.js';

/** 會計入「逛店連跑」的店型（站著逛的店；代購型藥妝與伴手禮不算，#117、§2.4 細則）。 */
export const SHOP_CATEGORIES = Object.freeze(['vintage', 'record', 'store', 'bookstore']);

/** 非主題日每天上限的三類（原話 #123、#143）。 */
export const SAME_TYPE_CATEGORIES = Object.freeze(['vintage', 'record', 'cafe']);

/** 那三類的人話名字（same-type-day、item-gap 的 warn 用；警告是畫面文字，不得露出店型鍵）。 */
export const SAME_TYPE_NAMES = Object.freeze({ vintage: '古著店', record: '唱片行', cafe: '咖啡廳' });

/**
 * 「為了買而去」的購物類店型（DESIGN §1.5「逛的：百貨、商店街、藥妝掃貨」；電器量販由原話 #55「相機這種比較專門的東西算是在購物日吧」；outlet 由 profile §5.11）：
 * 非購物日排進去罰（rules/shopping-day.js）、引擎自己插的順路站不拿（engine/trip.js onTheWayCandidates）。10-14 T22。
 */
export const SHOPPING_CATEGORIES = Object.freeze(['department', 'arcade', 'drugstore', 'electronics', 'outlet']);

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

/**
 * 步行預算的倍率：早起日、一日遊、女友同行、一日遊翌日同時中取最嚴（原話 #128）。一日遊本身也鬆（原話 #160「一日遊會舟車勞頓」），跟早起日同值。
 * 同行者的體力（day.adjust.stamina，engine/persons.js 人之間取最鬆，原話 #144；T19）：easy 多一個 settings.staminaEasyFactor（預設 0.85，推導：跟同行倍率同值）進 min；
 * hard 在取最嚴之後最後乘 settings.staminaHardFactor（預設 1.15，推導）；normal 不動。
 */
export function budgetMultiplier(day, settings) {
  const m = [1];
  if (day?.earlyDay) m.push(settings.earlyDayWalkFactor ?? 0.7);
  if (day?.dayTrip) m.push(settings.dayTripWalkFactor ?? 0.7);
  if ((day?.party ?? 1) >= 2) m.push(settings.partyWalkFactor ?? 0.85);
  if (day?.dayTripNext) m.push(settings.dayTripNextWalkFactor ?? 0.85);
  const stamina = day?.adjust?.stamina;
  if (stamina === 'easy') m.push(settings.staminaEasyFactor ?? 0.85);
  const strictest = Math.min(...m);
  return stamina === 'hard' ? strictest * (settings.staminaHardFactor ?? 1.15) : strictest;
}

/** 設定裡的 "13:00" 之類轉分鐘；已是數字就原樣。 */
export const toMin = (v) => (v == null ? null : hmToMin(v));

// ── 研究註記（知識庫欄位 researchRank／researchSkip／notAStop）──
// 研究以前把「首選」「保底備案」「可略過」這些判斷寫在店名括號裡、分配器認店名字樣；11-06 搬成知識庫欄位（原話 #191 其餘照預設；仙台包已搬完、站名清掉那些字）。
// 讀法一律「先讀欄位，整個欄位沒有才退回店名字樣」：別的城市的知識庫可能還沒欄位化。欄位寫了就由欄位決定、不再看店名（寫 null／false＝明講沒有這個註記）。
// 放這裡不放 engine/allocate.js：引擎插站的門（engine/trip.js engineMayInsert）也要讀，而 allocate.js 已經 import trip.js。規則本身不讀這三個欄位。
// 欄位規格（誰讀、怎麼填、合法值）寫在 data/schema.js 的 RESEARCH_FIELDS；值看不懂的由 normalizePoi 記警告，這裡一律當沒標。

/**
 * 店名字樣裡的研究註記（還沒欄位化的知識庫才靠它；kb-check 也拿它列「店名還帶註記字、沒有對應欄位」的站）：
 * rank：「首選」→ 'first'、「備案」「保底」「備援」→ 'backup'、都沒有 → null（兩種都寫時算首選，跟搬欄位前的判斷同一個先後）；
 * skip：「可略過」「不可指望」；notAStop：店名寫「A vs B」（前後有空白；店名開頭的 Vs 不算）。
 */
export function researchNameHints(p) {
  const name = String(p?.name_zh ?? '');
  return {
    rank: /首選/.test(name) ? 'first' : /備案|保底|備援/.test(name) ? 'backup' : null,
    skip: /可略過|不可指望/.test(name),
    notAStop: /\svs\.?\s/i.test(name),
  };
}

/**
 * 研究的先後註記 → 0 先挑（first）、1 沒標、2 後挑（backup）。分配器讀：餐段與夜間站挑店、同品項幾家落點挑哪家的第一個排序鍵；吃的站標 backup 不主動排當一餐。
 * 有 researchRank 欄位就照欄位（'first'／'backup' 以外的值、null 都算沒標）；整個欄位沒有才看店名字樣。
 */
export function researchRank(p) {
  const rank = p?.researchRank !== undefined ? p.researchRank : researchNameHints(p).rank;
  return rank === 'first' ? 0 : rank === 'backup' ? 2 : 1;
}

/**
 * 研究判這一站可略過（查過了：目標品不在、不可指望）：分配器不進池、引擎不主動插；他自己勾了照排，走廊清單照列。
 * 有 researchSkip 欄位就照欄位（一句理由的字串或 true＝略過；空字串、false、null＝不略過）；沒有這個欄位時，舊寫法 skip: true 也算，再沒有才看店名字樣。
 */
export function researchSaysSkip(p) {
  if (p?.researchSkip !== undefined) return p.researchSkip === true || (typeof p.researchSkip === 'string' && p.researchSkip.trim() !== '');
  if (p?.skip === true) return true;
  return researchNameHints(p).skip;
}

/**
 * 這一筆不是一個可以排的地點（研究拿兩家比較的摘要那種；跟一日遊複合條目同理，那種靠店型 daytrip 擋）：分配器不進池、引擎不主動插；他自己勾了照排。
 * 有 notAStop 欄位就照欄位（true 才算）；整個欄位沒有才看店名是不是「A vs B」。
 */
export function notAStop(p) {
  if (p?.notAStop !== undefined) return p.notAStop === true;
  return researchNameHints(p).notAStop;
}
