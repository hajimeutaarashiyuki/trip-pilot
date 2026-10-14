// 軟約束：購物類的站排在非購物日（原話 #36「出國的倒數一兩天才是購物行程」、#55「相機這種比較專門的東西算是在購物日吧，購物日本來就會去這些地方，甚至是唐吉訶德、藥妝店之類的」；
// DESIGN §1.5「category=shopping 的 POI 預設只排進購物日」、§5.2 舊成本表「非購物日排購物 +80」——10-14 T22 才落地成規則，penaltyMin 80 是那張表的數字，預設等級）。
// 購物類＝SHOPPING_CATEGORIES（百貨、商店街、藥妝、電器量販、outlet；rules/_helpers.js）。
// 例外不罰＝順路購買（原話 #29「如果有想要買的指定物品，會順路經過的話就直接安排進去」）：代購研究的站（stop.poi.item 有值）、他勾的待辦站（stop.errand，旅程檔 picks[].errand）。
// 購物日由 engine/trip.js shoppingDaysOf 推、寫進 day.shoppingDay；day.shoppingFromMin 有值時（三天旅程的「前一天下午」）站的開始時刻要 ≥ 它才算購物時段。
// day.shoppingDay 平常是 false、shoppingFromMin 平常是 null，都不列進 reads：missingReads 只把 undefined／null 當缺（false 不算），
// 列了的話 shoppingFromMin 是 null 的那幾天、沒帶這兩欄的 day 上下文（現場改案、舊快照）整條規則會被跳過；跟 meal-slots 讀 day.windowRaw 一樣由 apply 自己判。
import { SHOPPING_CATEGORIES } from './_helpers.js';
import { minToHm } from '../engine/time.js';

export default {
  id: 'shopping-day',
  kind: 'soft',
  reads: ['stop.poi.category'],
  defaults: { penaltyMin: 80 },
  apply(ctx) {
    return offDayShopping(ctx) ? ctx.params.penaltyMin : 0;
  },
  warn(ctx) {
    const name = ctx.stop.poi.name_zh;
    const day = ctx.day ?? {};
    if (day.shoppingDay && day.shoppingFromMin != null) return `${name} 是購物類的店，今天 ${minToHm(day.shoppingFromMin)} 起才是購物時段`;
    return `${name} 是購物類的店，今天不是購物日`;
  },
};

/** 這一站是不是「購物類的店排在非購物時段」：順路購買（有品項、他勾的待辦）不算。 */
function offDayShopping(ctx) {
  const stop = ctx.stop;
  if (!SHOPPING_CATEGORIES.includes(stop.poi.category)) return false;
  if (stop.poi.item || stop.errand === true) return false;
  const day = ctx.day ?? {};
  if (!day.shoppingDay) return true;
  return day.shoppingFromMin != null && stop.startMin < day.shoppingFromMin;
}
