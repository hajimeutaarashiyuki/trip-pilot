// 軟約束：恢復站連排（§2.4）。相鄰兩個恢復站 +pairMin；不分店型連排到第三個再 +runMin。
// 豁免：夜間續攤 bar→bar、晚餐→夜間站（餐→bar）不算連排（原話 #127、推導）。
import { isRecovery } from './_helpers.js';

const NIGHT = new Set(['bar']);
const FOOD = new Set(['food']);

export default {
  id: 'recovery-run',
  kind: 'soft',
  reads: ['stop.poi.recovery', 'acc.dim-rec-run'],
  defaults: { pairMin: 10, runMin: 40, runFrom: 3 },
  apply(ctx) {
    if (!isRecovery(ctx.stop) || !ctx.prev || !isRecovery(ctx.prev)) return 0;
    const a = ctx.prev.poi.category; const b = ctx.stop.poi.category;
    if (NIGHT.has(a) && NIGHT.has(b)) return 0;
    if (FOOD.has(a) && NIGHT.has(b)) return 0;
    let p = ctx.params.pairMin;
    if (ctx.acc['dim-rec-run'] >= ctx.params.runFrom) p += ctx.params.runMin;
    return p;
  },
  warn(ctx) {
    const n = ctx.acc['dim-rec-run'];
    return n >= ctx.params.runFrom ? `連續 ${n} 個坐下來的站，整個下午都坐著` : `${ctx.prev?.poi?.name_zh ?? '上一站'}接著${ctx.stop.poi.name_zh}，兩個坐下來的站連著`;
  },
};
