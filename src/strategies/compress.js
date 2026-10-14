// 壓縮：剩下每站停留等比縮短（只縮 want／maybe，must 不縮；最短不低於 minDwell），再重排（DESIGN §1.4 策略 1）。
// 釘起訖的固定時段（fixedWindow.endMin：研討會、預約）也不縮：它的結束由散場時刻釘（schedule.js placeStop 不看停留），縮了只會在 changes 裡說縮了、排出來一樣（10-14 T23 審查）；
// 只釘開始的（花火）停留是真的停留，照縮。
export default {
  id: 'compress',
  label: '每站縮短一點',
  apply({ remaining, settings }) {
    const factor = settings.compressFactor ?? 0.75;
    const minDwell = settings.compressMinDwell ?? 20;
    const changes = [];
    const candidates = remaining.map((c) => {
      if (c.priority === 'must' || Number.isFinite(c.fixedWindow?.endMin)) return c;
      const base = c.dwellMin ?? c.poi.dwellMin ?? settings.defaultDwellMin ?? 60;
      const dwellMin = Math.max(minDwell, Math.round((base * factor) / 5) * 5);
      if (dwellMin !== base) changes.push({ poiId: c.poi.id, from: base, to: dwellMin });
      return { ...c, dwellMin };
    });
    return { candidates, changes, note: `剩下的站各縮短到約 ${Math.round(factor * 100)}%，指定的不縮` };
  },
};
