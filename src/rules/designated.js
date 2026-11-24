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
  // 黃字寫店名（day.designatedNames：engine/trip.js 給的 id → 店名）；沒有才退回 id。之前一律印 id——平常指定站都排得進所以看不到，
  // 11-24 起他把指定的站換掉之後這一句會出現（對抗審查：「指定的 1 站今天排不進：utah」）。
  warn(ctx) {
    const placed = new Set(ctx.sequence.map((s) => s.poi.id));
    const missing = ctx.day.designated.filter((id) => !placed.has(id));
    return `指定的 ${missing.length} 站今天排不進：${missing.map((id) => ctx.day.designatedNames?.[id] ?? id).join('、')}`;
  },
};
