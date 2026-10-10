// 軟約束（整天）：指定行程與六星排不進只警告、不丟（profile §2.2 ②③、原話 #42）。
// 每一個沒排進的指定站罰 missMin 分鐘，讓引擎在可以的時候一定排它。
export default {
  id: 'designated',
  kind: 'soft',
  scope: 'day',
  reads: ['sequence', 'day.designated'],
  defaults: { missMin: 120 },
  apply(ctx) {
    const placed = new Set(ctx.sequence.map((s) => s.poi.id));
    const missing = ctx.day.designated.filter((id) => !placed.has(id));
    return missing.length * ctx.params.missMin;
  },
  warn(ctx) {
    const placed = new Set(ctx.sequence.map((s) => s.poi.id));
    const missing = ctx.day.designated.filter((id) => !placed.has(id));
    return `指定的 ${missing.length} 站今天排不進：${missing.join('、')}`;
  },
};
