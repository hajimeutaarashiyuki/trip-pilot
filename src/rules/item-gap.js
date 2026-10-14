// 硬約束（整天）：同一品項的主題日不連續兩天（原話 #65「整天皮衣、整天黑膠」；#137：單一站不算，只有整天主題才算）。
import { SAME_TYPE_NAMES } from './_helpers.js';

export default {
  id: 'item-gap',
  kind: 'hard',
  scope: 'day',
  reads: [],   // themeCategory 沒有（非主題日）是正常狀態，不算缺欄位；apply 自己處理 null
  defaults: {},
  apply(ctx) {
    const t = ctx.day.themeCategory;
    if (!t) return 'ok';
    return ctx.day.prevThemeCategory === t ? 'no' : 'ok';
  },
  // 警告是畫面文字：主題寫人話（古著店、唱片行、咖啡廳），不露店型鍵（10-14 T25 審查後改，原本直接印 themeCategory）
  warn(ctx) {
    const name = SAME_TYPE_NAMES[ctx.day.themeCategory] ?? '同一類的店';
    return `昨天已經整天逛${name}，今天又是，會膩`;
  },
};
