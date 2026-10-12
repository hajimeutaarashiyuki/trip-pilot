// 硬約束：引擎填等開門空檔的站（priority 'filler'，trip.js fillCandidates）只能落在它被找來填的那段空檔內。
// 原話 #161 答的是「等開門的空檔」，不是一天裡任何位置；沒這條的話試走包 8/13 的唐吉訶德離它被找來填的空檔 8 小時（2026-10-12 對抗審查）。
// 空檔＝第一趟排程裡前一站結束到等開門那站開門（candidate.gap）；填站的起訖都要在裡面，超出＝never（再往後插只會更晚）。
// 填站自己也不能等開門（原話 #164：「禁 我就要在等開門 還是再等一次？」）：waitMin > 0 ＝ never。
// gap 只有填站才有、其他站是 null（正常狀態），不列進 reads，apply 自己判。
import { minToHm } from '../engine/time.js';

export default {
  id: 'filler-gap',
  kind: 'hard',
  reads: [],
  defaults: {},
  apply(ctx) {
    const gap = ctx.stop.gap;
    if (ctx.stop.priority !== 'filler' || !gap) return 'ok';
    if ((ctx.stop.waitMin ?? 0) > 0) return 'never';
    return ctx.stop.startMin < gap.startMin || ctx.stop.endMin > gap.endMin ? 'never' : 'ok';
  },
  warn(ctx) {
    const gap = ctx.stop.gap;
    if ((ctx.stop.waitMin ?? 0) > 0) return `${ctx.stop.poi.name_zh} 填進去還要再等開門 ${Math.round(ctx.stop.waitMin)} 分`;
    return `${ctx.stop.poi.name_zh} 不在空檔內（${minToHm(gap.startMin)}–${minToHm(gap.endMin)}）`;
  },
};
