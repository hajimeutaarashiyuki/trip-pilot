// 軟約束（整天）：每天預設要有一個早餐（原話 #196「還有預設上每天都要有早餐的安排 但我也有可能在飯店吃早餐 所以早餐的按鈕會不太一樣 不是不去了可能是改天去或是我吃飯店早餐」；11-06 第二批）。
// 推翻 DESIGN §11.1 Q4「早餐不管、不替你挑店」（那是他當時照單全收的提案＝預設；現在有原話）。
// 國家層 country.mealSlots 有 breakfast 這一段才動作（日本值 07:00–10:00，kb/country/jp.json）；沒有這個鍵時這條規則永遠回 0——舊打包檔的結果不變。
// 這個鍵選填，所以不列進 reads（列了框架會因缺欄位跳過、記一條「規則因缺欄位跳過」的警告，報告就多一行）；apply 自己看。
// 要不要早餐、缺不缺跟午餐晚餐同一把尺（rules/_slots.js breakfastMissing → missingMeals）：早餐段跟當天原時窗有重疊、沒被固定時段的站蓋住才要；
// 他說這天不排的（旅程檔 days[].breakfast：吃飯店早餐／改天去）不要；他勾的站裡有能當早餐、落在早餐時窗的就算有；引擎替他排的早餐（stop.priority 'breakfast'）也算。
// 罰 missMin（預設 10，比午餐晚餐的 20 輕——他本來就可能吃飯店；主控 11-06 定）。搜尋時這 10 分讓「他勾的站裡能當早餐的那一家排在早上」稍微佔一點便宜；
// 引擎替他挑的早餐是搜尋排完之後才安插的（engine/breakfast.js），安插後整天重算，這條就不罰了。
// quiet：只進罰分、不出黃字。「今天沒排早餐」是提示樣式的一句（rules/_slots.js breakfastHints，engine/trip.js 排完才掛）——缺早餐不是黃字。
import { breakfastMissing, MEAL_NAMES } from './_slots.js';

export default {
  id: 'breakfast-slot',
  kind: 'soft',
  scope: 'day',
  quiet: true,
  reads: ['sequence'],
  defaults: { missMin: 10 },
  apply(ctx) {
    return breakfastMissing(ctx) ? ctx.params.missMin : 0;
  },
  warn() {
    return `今天沒排${MEAL_NAMES.breakfast}`;
  },
};
