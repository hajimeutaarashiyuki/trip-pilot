// 把一站（或一整天）交給所有規則評。核心只認三種介面（計畫 1b §0）：
//   hard      → 'ok' | 'no' | 'never'   never＝再往後插也不可能，DFS 剪整枝
//   soft      → 分鐘數（≥0）           乘上 weight 累加成罰款
//   dimension → 新的累積值            先踏一站更新累積量，hard／soft 再看更新後的值
// 缺欄位的規則對該站跳過並警告；規則丟例外也當跳過並警告，排程不炸（總則 0）。
import { stepAcc } from './dims.js';
import { missingReads, warnText } from '../rules/index.js';

const WORST = { ok: 0, no: 1, never: 2 };

function runRule(rule, ctx, warnings) {
  const missing = missingReads(rule, ctx);
  if (missing.length) {
    warnings.push({ ruleId: rule.id, code: 'skipped-missing', poiId: ctx.stop?.poi?.id, msg: `${rule.id} 跳過：缺 ${missing.join('、')}` });
    return undefined;
  }
  try { return rule.apply({ ...ctx, params: rule.params, ruleId: rule.id }); } catch (err) {
    warnings.push({ ruleId: rule.id, code: 'rule-error', poiId: ctx.stop?.poi?.id, msg: `${rule.id} 出錯，當作跳過：${err?.message ?? err}` });
    return undefined;
  }
}

function applyHardSoft({ hard, soft }, ctx, scope) {
  const warnings = [];
  let verdict = 'ok';
  const breakdown = [];
  for (const rule of hard) {
    if (rule.scope !== scope) continue;
    const v = runRule(rule, ctx, warnings);
    if (v === undefined || v === 'ok') continue;
    if (v !== 'no' && v !== 'never') { warnings.push({ ruleId: rule.id, code: 'rule-error', msg: `${rule.id} 硬約束回了看不懂的值：${v}` }); continue; }
    if (WORST[v] > WORST[verdict]) verdict = v;
    warnings.push({ ruleId: rule.id, code: 'hard', poiId: ctx.stop?.poi?.id, msg: warnText(rule, ctx) });
  }
  let penaltyMin = 0;
  for (const rule of soft) {
    if (rule.scope !== scope) continue;
    const v = runRule(rule, ctx, warnings);
    if (v === undefined) continue;
    const minutes = Number(v);
    if (!Number.isFinite(minutes) || minutes < 0) { warnings.push({ ruleId: rule.id, code: 'rule-error', msg: `${rule.id} 軟約束要回 ≥0 的分鐘數：${v}` }); continue; }
    if (minutes === 0) continue;
    const weighted = minutes * rule.weight;
    penaltyMin += weighted;
    breakdown.push({ ruleId: rule.id, minutes, weight: rule.weight, weighted });
    if (!rule.quiet) warnings.push({ ruleId: rule.id, code: 'soft', poiId: ctx.stop?.poi?.id, msg: warnText(rule, ctx) });   // quiet：每段都有的成本（walk-cost）只進罰分，不出黃字
  }
  return { verdict, penaltyMin, breakdown, warnings };
}

/**
 * 評一站：先更新累積量，再跑 stop scope 的硬與軟規則。
 * ctx 形狀固定：{ day, stop, prev, next, leg, acc, settings, kb, country }
 * 回 { verdict, penaltyMin, acc, breakdown, warnings }
 */
export function evaluateStop(ctx, rules) {
  const stepped = stepAcc(rules.dims, ctx);
  const ctx2 = { ...ctx, accBefore: ctx.acc, acc: stepped.acc };
  const r = applyHardSoft(rules, ctx2, 'stop');
  return { verdict: r.verdict, penaltyMin: r.penaltyMin, acc: stepped.acc, breakdown: r.breakdown, warnings: [...stepped.warnings, ...r.warnings] };
}

/** 評一整天（排完後）：day scope 的硬與軟規則；ctx 要帶 sequence 與最終 acc。 */
export function evaluateDay(ctx, rules) {
  return applyHardSoft(rules, ctx, 'day');
}
