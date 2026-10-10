// 移到別天：把今天塞不下、又還有別天可去的站拿出來（標 movedOut），今天只排剩下的（DESIGN §1.4 策略 4）。
// 「別天可去」要知識庫有公休資料：這裡只看 c.poi.otherDaysOpen（由上層算好）；沒有這個欄位的站不移。
export default {
  id: 'move-day',
  label: '幾站挪到別天',
  apply({ remaining }) {
    const movable = remaining.filter((c) => c.priority !== 'must' && Array.isArray(c.poi.otherDaysOpen) && c.poi.otherDaysOpen.length);
    if (!movable.length) return null;
    // 先挪價值最低的（maybe 先於 want），最多挪一半，讓今天鬆一點
    const order = { maybe: 0, want: 1 };
    const toMove = [...movable].sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2)).slice(0, Math.max(1, Math.floor(movable.length / 2)));
    const movedIds = new Set(toMove.map((c) => c.poi.id));
    return {
      candidates: remaining.filter((c) => !movedIds.has(c.poi.id)),
      changes: toMove.map((c) => ({ poiId: c.poi.id, toDays: c.poi.otherDaysOpen })),
      note: `${toMove.map((c) => c.poi.name_zh).join('、')} 挪到別天，今天留白`,
    };
  },
};
