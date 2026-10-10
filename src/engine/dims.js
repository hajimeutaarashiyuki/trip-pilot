// 沿路累積量（dimension）的框架。
// 每條 dimension 規則自己決定怎麼累積、何時歸零：apply(ctx) 回傳「這一維的新值」，
// 目前值在 ctx.acc[rule.id]。值可以是數字或物件（例如逛店連跑 { count, min }）。
// acc 是不可變的：每踏一站產生新物件，DFS 回溯不用還原。
import { missingReads } from '../rules/index.js';

/** 起始累積量：每一維用它的 params.initial（沒寫就是 0）。 */
export function emptyAcc(dims) {
  const acc = {};
  for (const d of dims) acc[d.id] = d.params?.initial ?? 0;
  return acc;
}

/**
 * 踏上一站後的累積量。缺欄位的維度保持原值並回一條警告（決策樹 Q11）。
 * 回 { acc, warnings }。
 */
export function stepAcc(dims, ctx) {
  const next = { ...ctx.acc };
  const warnings = [];
  for (const d of dims) {
    const missing = missingReads(d, ctx);
    if (missing.length) {
      warnings.push({ ruleId: d.id, code: 'skipped-missing', poiId: ctx.stop?.poi?.id, msg: `${d.id} 跳過：缺 ${missing.join('、')}` });
      continue;
    }
    next[d.id] = d.apply({ ...ctx, params: d.params, ruleId: d.id });
  }
  return { acc: next, warnings };
}
