// 規則註冊表（計畫 1b §2.1）。
// 每條規則一個檔，匯出 { id, kind, scope?, reads, defaults, apply, warn? }；這裡負責：
//   - 套 rules.json 的覆寫（weight、門檻），weight 0 的整條不載入
//   - 驗形狀：kind 只能是 hard／soft／dimension；apply 必須是函式；reads 必須是陣列
//   - 按 kind 分組給引擎用
// 核心不知道任何一條規則的內容；加一條規則＝在 BUILTIN 多一行 import。

export const KINDS = Object.freeze(['hard', 'soft', 'dimension']);
export const SCOPES = Object.freeze(['stop', 'day']);

/** 檢查一條規則的形狀；錯了丟 Error（載入期就該炸，不要到排程時才發現）。 */
export function validateRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('規則不是物件');
  if (typeof rule.id !== 'string' || !/^[a-z0-9-]+$/.test(rule.id)) throw new Error(`規則 id 要是小寫英數與連字號：${rule?.id}`);
  if (!KINDS.includes(rule.kind)) throw new Error(`規則 ${rule.id} 的 kind 只能是 ${KINDS.join('／')}：${rule.kind}`);
  const scope = rule.scope ?? 'stop';
  if (!SCOPES.includes(scope)) throw new Error(`規則 ${rule.id} 的 scope 只能是 ${SCOPES.join('／')}：${scope}`);
  if (!Array.isArray(rule.reads)) throw new Error(`規則 ${rule.id} 要宣告 reads（讀哪些欄位）`);
  if (typeof rule.apply !== 'function') throw new Error(`規則 ${rule.id} 缺 apply()`);
  if (rule.defaults != null && typeof rule.defaults !== 'object') throw new Error(`規則 ${rule.id} 的 defaults 要是物件`);
  if (rule.kind === 'dimension' && scope !== 'stop') throw new Error(`規則 ${rule.id}：dimension 只能是 stop scope`);
  return { ...rule, scope };
}

/**
 * loadRules(registry, config) → { hard, soft, dims, byId, disabled }
 * registry：規則物件陣列（例如 BUILTIN）；config：rules.json 的 rules 區段 { [id]: { weight?, ...overrides } }
 * 每條規則的參數＝defaults ← config 覆寫；weight 預設 1；weight 0 ＝ 停用。
 */
export function loadRules(registry, config = {}) {
  const hard = []; const soft = []; const dims = []; const byId = new Map(); const disabled = [];
  for (const raw of registry) {
    const rule = validateRule(raw);
    if (byId.has(rule.id)) throw new Error(`規則 id 重複：${rule.id}`);
    const override = config[rule.id] ?? {};
    const { weight = 1, ...params } = override;
    if (weight === 0) { disabled.push(rule.id); continue; }
    const loaded = { ...rule, weight, params: { ...(rule.defaults ?? {}), ...params } };
    byId.set(rule.id, loaded);
    ({ hard, soft, dimension: dims })[rule.kind].push(loaded);
  }
  return { hard, soft, dims, byId, disabled };
}

/** 一條規則需要的欄位在這一站上齊不齊；缺的欄位名回傳出來（引擎據此跳過並警告，決策樹 Q11）。 */
export function missingReads(rule, ctx) {
  const missing = [];
  for (const path of rule.reads) {
    const v = getPath(ctx, path);
    if (v === undefined || v === null) missing.push(path);
  }
  return missing;
}

/** 'stop.poi.walkFactor' 這種路徑取值；中途遇到 null 回 undefined。 */
export function getPath(obj, path) {
  let cur = obj;
  for (const key of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** 人話警告：規則有 warn() 就用，沒有就用 id。 */
export function warnText(rule, ctx) {
  try { return typeof rule.warn === 'function' ? rule.warn({ ...ctx, params: rule.params, ruleId: rule.id }) : rule.id; } catch { return rule.id; }
}
